// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited
/**
 * Context Artifacts — give the AI awareness of non-code project knowledge.
 *
 * Users define artifacts (database schemas, API specs, infra configs, etc.)
 * in a `.socraticodecontextartifacts.json` file at the project root. Each artifact points to
 * a file or directory with a name and description.
 *
 * Artifacts are chunked and embedded into Qdrant (collection: context_{projectId})
 * for semantic search, using the same hybrid dense + BM25 approach as code search.
 *
 * Staleness detection: each artifact's content hash is stored. When a search is
 * performed, stale artifacts are automatically re-indexed (artifacts are typically
 * small, so re-indexing takes seconds).
 */

import { createHash } from "node:crypto";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { glob } from "glob";
import { contextCollectionName, projectIdFromPath } from "../config.js";
import { CHUNK_OVERLAP, CHUNK_SIZE, MAX_CHUNK_CHARS } from "../constants.js";
import type { ArtifactIndexState, ContextArtifact, SearchResult } from "../types.js";
import { generateEmbeddings, prepareDocumentText } from "./embeddings.js";
import { logger } from "./logger.js";
import {
  deleteArtifactChunks,
  deleteCollection,
  deleteContextMetadata,
  ensureCollection,
  ensurePayloadIndex,
  getCollectionInfo,
  loadContextMetadata,
  saveContextMetadata,
  searchChunks,
  searchChunksWithFilter,
  upsertPreEmbeddedChunks,
} from "./qdrant.js";

// ── Config file parsing ──────────────────────────────────────────────────

const CONFIG_FILENAME = ".socraticodecontextartifacts.json";

export interface SocratiCodeConfig {
  artifacts?: ContextArtifact[];
}

/**
 * Load and validate .socraticodecontextartifacts.json from a project root.
 * Returns null if the file doesn't exist. Throws on parse/validation errors.
 */
export async function loadConfig(projectPath: string): Promise<SocratiCodeConfig | null> {
  const configPath = path.join(path.resolve(projectPath), CONFIG_FILENAME);
  // Fall back to a global config location when no project-level config exists.
  // Configurable via env var SOCRATICODE_GLOBAL_CONFIG_DIR; defaults to ~/.claude/arch.
  const globalConfigDir =
    process.env.SOCRATICODE_GLOBAL_CONFIG_DIR || path.join(os.homedir(), ".claude", "arch");
  const globalConfigPath = path.join(globalConfigDir, CONFIG_FILENAME);
  let actualPath = configPath;
  let usingGlobalFallback = false;

  try {
    await fsp.access(configPath);
  } catch {
    try {
      await fsp.access(globalConfigPath);
      actualPath = globalConfigPath;
      usingGlobalFallback = true;
    } catch {
      return null; // neither project nor global file exists — that's fine
    }
  }

  const raw = await fsp.readFile(actualPath, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `.socraticodecontextartifacts.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(".socraticodecontextartifacts.json must be a JSON object");
  }

  const config = parsed as Record<string, unknown>;
  const artifacts = config.artifacts;

  if (artifacts !== undefined) {
    if (!Array.isArray(artifacts)) {
      throw new Error('.socraticodecontextartifacts.json: "artifacts" must be an array');
    }

    for (let i = 0; i < artifacts.length; i++) {
      const a = artifacts[i];
      if (typeof a !== "object" || a === null || Array.isArray(a)) {
        throw new Error(`.socraticodecontextartifacts.json: artifacts[${i}] must be an object`);
      }
      const artifact = a as Record<string, unknown>;
      if (typeof artifact.name !== "string" || !artifact.name.trim()) {
        throw new Error(`.socraticodecontextartifacts.json: artifacts[${i}].name must be a non-empty string`);
      }
      if (typeof artifact.path !== "string" || !artifact.path.trim()) {
        throw new Error(`.socraticodecontextartifacts.json: artifacts[${i}].path must be a non-empty string`);
      }
      if (typeof artifact.description !== "string" || !artifact.description.trim()) {
        throw new Error(`.socraticodecontextartifacts.json: artifacts[${i}].description must be a non-empty string`);
      }
    }

    // Check for duplicate names
    const names = new Set<string>();
    for (const a of artifacts as ContextArtifact[]) {
      const normalized = a.name.trim().toLowerCase();
      if (names.has(normalized)) {
        throw new Error(`.socraticodecontextartifacts.json: duplicate artifact name "${a.name}"`);
      }
      names.add(normalized);
    }
  }

  // When config was loaded from the global fallback directory, resolve relative
  // artifact paths against that directory so downstream code (which assumes
  // project-root resolution) receives correct absolute paths.
  if (usingGlobalFallback && Array.isArray(config.artifacts)) {
    const baseDir = path.dirname(actualPath);
    config.artifacts = (config.artifacts as ContextArtifact[]).map((artifact) => ({
      ...artifact,
      path: path.isAbsolute(artifact.path) ? artifact.path : path.resolve(baseDir, artifact.path),
    }));
  }

  return config as SocratiCodeConfig;
}

// ── File reading ─────────────────────────────────────────────────────────

/**
 * Read the content of an artifact. If the path points to a directory,
 * concatenates all files within it (recursively), separated by headers.
 * Returns the combined content and a content hash for staleness detection.
 */
export async function readArtifactContent(
  artifactPath: string,
  projectPath: string,
): Promise<{ content: string; contentHash: string }> {
  const resolved = path.isAbsolute(artifactPath)
    ? artifactPath
    : path.resolve(projectPath, artifactPath);

  const stat = await fsp.stat(resolved);

  if (stat.isFile()) {
    const content = await fsp.readFile(resolved, "utf-8");
    const contentHash = hashContent(content);
    return { content, contentHash };
  }

  if (stat.isDirectory()) {
    // Find all files in the directory (recursively, skip hidden/dot-files)
    const files = await glob("**/*", {
      cwd: resolved,
      nodir: true,
      dot: false,
      ignore: ["**/node_modules/**", "**/.git/**"],
    });

    files.sort(); // deterministic ordering

    const parts: string[] = [];
    for (const file of files) {
      const filePath = path.join(resolved, file);
      try {
        const content = await fsp.readFile(filePath, "utf-8");
        parts.push(`# ── ${file} ──\n${content}`);
      } catch {
        // skip unreadable files (binary, permissions, etc.)
        logger.debug(`Artifact: skipping unreadable file ${file}`);
      }
    }

    if (parts.length === 0) {
      throw new Error(`Artifact directory is empty or contains no readable files: ${resolved}`);
    }

    const combined = parts.join("\n\n");
    const contentHash = hashContent(combined);
    return { content: combined, contentHash };
  }

  throw new Error(`Artifact path is neither a file nor a directory: ${resolved}`);
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

// ── Chunking ─────────────────────────────────────────────────────────────

interface ArtifactChunk {
  id: string;
  content: string;
  startLine: number;
  endLine: number;
  artifactName: string;
}

/**
 * Chunk artifact content using line-based chunking with overlap.
 * Simple and universal — works for SQL, YAML, Protobuf, Markdown, etc.
 */
export function chunkArtifactContent(
  content: string,
  artifactName: string,
  artifactPath: string,
): ArtifactChunk[] {
  if (!content) return [];
  const lines = content.split("\n");
  if (lines.length === 0) return [];

  const chunks: ArtifactChunk[] = [];

  for (let start = 0; start < lines.length; start += CHUNK_SIZE - CHUNK_OVERLAP) {
    const end = Math.min(start + CHUNK_SIZE, lines.length);
    let chunkContent = lines.slice(start, end).join("\n");

    // Apply hard character cap
    if (chunkContent.length > MAX_CHUNK_CHARS) {
      chunkContent = chunkContent.substring(0, MAX_CHUNK_CHARS);
    }

    const id = generateChunkId(artifactPath, artifactName, start);

    chunks.push({
      id,
      content: chunkContent,
      startLine: start + 1, // 1-based
      endLine: end,
      artifactName,
    });

    if (end >= lines.length) break;
  }

  return chunks;
}

function generateChunkId(artifactPath: string, artifactName: string, startLine: number): string {
  const hash = createHash("sha256")
    .update(`context:${artifactPath}:${artifactName}:${startLine}`)
    .digest("hex")
    .slice(0, 32);
  // Format as UUID: 8-4-4-4-12
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

// ── Indexing ─────────────────────────────────────────────────────────────

/**
 * Index a single artifact into Qdrant.
 * Removes any existing chunks for this artifact first, then inserts new ones.
 */
export async function indexArtifact(
  projectPath: string,
  artifact: ContextArtifact,
  collection: string,
): Promise<ArtifactIndexState> {
  const resolvedProject = path.resolve(projectPath);
  const resolvedArtifactPath = path.isAbsolute(artifact.path)
    ? artifact.path
    : path.resolve(resolvedProject, artifact.path);

  logger.info("Indexing context artifact", {
    name: artifact.name,
    path: resolvedArtifactPath,
  });

  // Read content
  const { content, contentHash } = await readArtifactContent(artifact.path, resolvedProject);

  // Chunk
  const chunks = chunkArtifactContent(content, artifact.name, artifact.path);

  if (chunks.length === 0) {
    logger.warn("Artifact produced zero chunks", { name: artifact.name });
    return {
      name: artifact.name,
      description: artifact.description,
      resolvedPath: resolvedArtifactPath,
      contentHash,
      lastIndexedAt: new Date().toISOString(),
      chunksIndexed: 0,
    };
  }

  // Ensure collection exists before any operations on it
  await ensureCollection(collection);

  // Ensure artifactName payload index exists (idempotent)
  await ensurePayloadIndex(collection, "artifactName");

  // Delete old chunks for this artifact (safe now that collection exists)
  await deleteArtifactChunks(collection, artifact.name);

  // Generate embeddings
  const texts = chunks.map((c) =>
    prepareDocumentText(c.content, `context:${artifact.name}:${path.normalize(artifact.path)}`),
  );
  const embeddings = await generateEmbeddings(texts);

  // Build pre-embedded points
  const points = chunks.map((chunk, i) => ({
    id: chunk.id,
    vector: embeddings[i],
    bm25Text: texts[i],
    payload: {
      artifactName: chunk.artifactName,
      artifactDescription: artifact.description,
      filePath: resolvedArtifactPath,
      relativePath: artifact.path,
      content: chunk.content,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      language: "context",
      type: "artifact",
      contentHash,
    } as Record<string, unknown>,
  }));

  const { pointsSkipped } = await upsertPreEmbeddedChunks(collection, points);

  if (pointsSkipped > 0 && pointsSkipped === points.length) {
    throw new Error(
      `Qdrant upsert: all ${points.length} points for artifact "${artifact.name}" ` +
      `were skipped (collection=${collection}). The collection may have been deleted externally.`
    );
  }

  logger.info("Indexed context artifact", {
    name: artifact.name,
    chunks: chunks.length,
  });

  return {
    name: artifact.name,
    description: artifact.description,
    resolvedPath: resolvedArtifactPath,
    contentHash,
    lastIndexedAt: new Date().toISOString(),
    chunksIndexed: chunks.length,
  };
}

/**
 * Index all artifacts defined in .socraticodecontextartifacts.json.
 * Returns the list of indexed artifact states.
 */
export async function indexAllArtifacts(projectPath: string): Promise<{
  indexed: ArtifactIndexState[];
  errors: Array<{ name: string; error: string }>;
}> {
  const resolvedProject = path.resolve(projectPath);
  const projectId = projectIdFromPath(resolvedProject);
  const collection = contextCollectionName(projectId);

  const config = await loadConfig(resolvedProject);
  if (!config?.artifacts?.length) {
    return { indexed: [], errors: [] };
  }

  const indexed: ArtifactIndexState[] = [];
  const errors: Array<{ name: string; error: string }> = [];
  const configNames = new Set(config.artifacts.map((a) => a.name));
  const stateMap = new Map<string, ArtifactIndexState>();

  const existingStates = await loadContextMetadata(collection);
  if (existingStates) {
    for (const state of existingStates) {
      if (configNames.has(state.name)) {
        stateMap.set(state.name, state);
      }
    }
  }

  for (const artifact of config.artifacts) {
    try {
      const state = await indexArtifact(resolvedProject, artifact, collection);
      indexed.push(state);
      stateMap.set(artifact.name, state);
      await saveContextMetadata(collection, resolvedProject, [...stateMap.values()]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("Failed to index artifact", { name: artifact.name, error: msg });
      errors.push({ name: artifact.name, error: msg });
    }
  }

  // Save final metadata, even if all artifacts failed, so removed artifacts no
  // longer linger in status after a config change.
  if (stateMap.size > 0 || existingStates?.length) {
    await saveContextMetadata(collection, resolvedProject, [...stateMap.values()]);
  }

  return { indexed, errors };
}

/**
 * Ensure all artifacts are indexed and up to date.
 * Compares content hashes to detect staleness and only re-indexes changed artifacts.
 * Returns true if any re-indexing occurred.
 */
export async function ensureArtifactsIndexed(projectPath: string): Promise<{
  reindexed: string[];
  upToDate: string[];
  errors: Array<{ name: string; error: string }>;
}> {
  const resolvedProject = path.resolve(projectPath);
  const projectId = projectIdFromPath(resolvedProject);
  const collection = contextCollectionName(projectId);

  const config = await loadConfig(resolvedProject);
  if (!config?.artifacts?.length) {
    return { reindexed: [], upToDate: [], errors: [] };
  }

  // Load existing metadata
  const existingStates = await loadContextMetadata(collection);
  const stateMap = new Map<string, ArtifactIndexState>();
  if (existingStates) {
    for (const s of existingStates) {
      stateMap.set(s.name, s);
    }
  }

  const reindexed: string[] = [];
  const upToDate: string[] = [];
  const errors: Array<{ name: string; error: string }> = [];
  const configNames = new Set(config.artifacts.map((a) => a.name));

  for (const name of [...stateMap.keys()]) {
    if (!configNames.has(name)) {
      stateMap.delete(name);
    }
  }

  for (const artifact of config.artifacts) {
    try {
      const existing = stateMap.get(artifact.name);

      // Read current content hash
      const { contentHash: currentHash } = await readArtifactContent(
        artifact.path,
        resolvedProject,
      );

      if (existing && existing.contentHash === currentHash) {
        // Up to date
        upToDate.push(artifact.name);
      } else {
        // Stale or new — re-index
        const state = await indexArtifact(resolvedProject, artifact, collection);
        reindexed.push(artifact.name);
        stateMap.set(artifact.name, state);
        await saveContextMetadata(collection, resolvedProject, [...stateMap.values()]);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("Failed to check/index artifact", { name: artifact.name, error: msg });
      errors.push({ name: artifact.name, error: msg });
    }
  }

  // Remove artifacts that are no longer in config
  for (const name of existingStates?.map((s) => s.name) ?? []) {
    if (!configNames.has(name)) {
      try {
        await deleteArtifactChunks(collection, name);
        stateMap.delete(name);
        logger.info("Removed artifact no longer in config", { name });
      } catch {
        // ignore
      }
    }
  }

  // Save updated metadata, even when only removals happened.
  if (stateMap.size > 0 || existingStates?.length) {
    await saveContextMetadata(collection, resolvedProject, [...stateMap.values()]);
  }

  return { reindexed, upToDate, errors };
}

// ── Search ───────────────────────────────────────────────────────────────

/**
 * Search across context artifacts using hybrid semantic + BM25 search.
 * Optionally filter by artifact name.
 */
export async function searchArtifacts(
  projectPath: string,
  query: string,
  artifactName?: string,
  limit: number = 10,
): Promise<SearchResult[]> {
  const resolvedProject = path.resolve(projectPath);
  const projectId = projectIdFromPath(resolvedProject);
  const collection = contextCollectionName(projectId);

  // Check if collection exists
  const info = await getCollectionInfo(collection);
  if (!info || info.pointsCount === 0) {
    return [];
  }

  // Use the existing searchChunks with artifactName filtering
  if (artifactName) {
    return searchChunksWithFilter(collection, query, limit, [
      { key: "artifactName", value: artifactName },
    ]);
  }

  return searchChunks(collection, query, limit);
}

// ── Removal ──────────────────────────────────────────────────────────────

/**
 * Remove all context artifacts for a project.
 */
export async function removeAllArtifacts(projectPath: string): Promise<void> {
  const resolvedProject = path.resolve(projectPath);
  const projectId = projectIdFromPath(resolvedProject);
  const collection = contextCollectionName(projectId);

  await deleteCollection(collection);
  await deleteContextMetadata(collection);

  logger.info("Removed all context artifacts", { projectPath: resolvedProject });
}

// ── Status summary (reusable by codebase_status, codebase_list_projects, etc.) ──

/**
 * Get a compact artifact status summary for a project.
 * Returns null if no .socraticodecontextartifacts.json exists.
 * This is the canonical helper for integrating artifact status into other commands.
 */
export async function getArtifactStatusSummary(projectPath: string): Promise<{
  configuredCount: number;
  indexedCount: number;
  totalChunks: number;
  lines: string[];
} | null> {
  const resolvedProject = path.resolve(projectPath);
  const config = await loadConfig(resolvedProject);
  if (!config?.artifacts?.length) return null;

  const projectId = projectIdFromPath(resolvedProject);
  const collection = contextCollectionName(projectId);
  const existingStates = await loadContextMetadata(collection);
  const stateMap = new Map(
    existingStates?.map((s) => [s.name, s]) ?? [],
  );

  let indexedCount = 0;
  let totalChunks = 0;
  for (const artifact of config.artifacts) {
    const state = stateMap.get(artifact.name);
    if (state) {
      indexedCount++;
      totalChunks += state.chunksIndexed;
    }
  }

  const lines: string[] = [];
  if (indexedCount === config.artifacts.length) {
    lines.push(`Context artifacts: ${indexedCount} artifact${indexedCount === 1 ? "" : "s"} indexed (${totalChunks} chunks)`);
  } else if (indexedCount === 0) {
    lines.push(`Context artifacts: ${config.artifacts.length} configured, not yet indexed`);
    lines.push("  Run codebase_context_index or search with codebase_context_search to auto-index.");
  } else {
    lines.push(`Context artifacts: ${indexedCount}/${config.artifacts.length} indexed (${totalChunks} chunks)`);
    lines.push("  Some artifacts are not yet indexed. Run codebase_context_index to index all.");
  }

  return { configuredCount: config.artifacts.length, indexedCount, totalChunks, lines };
}
