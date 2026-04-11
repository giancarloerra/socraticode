// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited

import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { Lang, registerDynamicLanguage } from "@ast-grep/napi";
import { graphCollectionName, projectIdFromPath } from "../config.js";
import { EXTRA_EXTENSIONS, getLanguageFromExtension, MAX_GRAPH_FILE_BYTES } from "../constants.js";
import type { CodeGraph, CodeGraphEdge, CodeGraphNode } from "../types.js";
import { loadPathAliases } from "./graph-aliases.js";
import { extractImports } from "./graph-imports.js";
import { buildJvmSuffixMap, resolveImport } from "./graph-resolution.js";
import { createIgnoreFilter, shouldIgnore } from "./ignore.js";
import { logger } from "./logger.js";
import { deleteGraphData, getGraphMetadata, loadGraphData, saveGraphData } from "./qdrant.js";

// Re-export analysis functions for external consumers
export { findCircularDependencies, generateMermaidDiagram, getFileDependencies, getGraphStats } from "./graph-analysis.js";

// createRequire needed to load native addon packages in ESM
const esmRequire = createRequire(import.meta.url);

// ── Graph build progress tracking ────────────────────────────────────────

/** Progress details for an in-flight graph build operation */
export interface GraphBuildProgress {
  startedAt: number;       // Date.now()
  filesTotal: number;
  filesProcessed: number;
  phase: string;           // "scanning files" | "analyzing imports" | "persisting"
  error?: string;
}

/** Summary of a completed graph build operation */
export interface GraphBuildCompleted {
  completedAt: number;     // Date.now()
  durationMs: number;
  filesProcessed: number;
  nodesCreated: number;
  edgesCreated: number;
  error?: string;
}

/** Track which projects currently have a graph build in flight */
const graphBuildInProgress = new Map<string, GraphBuildProgress>();

/** In-flight build promises — allows callers to share a single build */
const graphBuildPromises = new Map<string, Promise<CodeGraph>>();

/** Track the last completed graph build per project */
const lastGraphBuildCompleted = new Map<string, GraphBuildCompleted>();

/** Check if a graph build is currently in progress for a project */
export function isGraphBuildInProgress(projectPath: string): boolean {
  return graphBuildInProgress.has(path.resolve(projectPath));
}

/** Get progress details for a graph build currently in progress */
export function getGraphBuildProgress(projectPath: string): GraphBuildProgress | null {
  return graphBuildInProgress.get(path.resolve(projectPath)) ?? null;
}

/** Get the last completed graph build for a project */
export function getLastGraphBuildCompleted(projectPath: string): GraphBuildCompleted | null {
  return lastGraphBuildCompleted.get(path.resolve(projectPath)) ?? null;
}

/** Get all projects currently building a graph */
export function getGraphBuildInProgressProjects(): string[] {
  return Array.from(graphBuildInProgress.keys());
}

// ── Graph cache (service-level, shared by tools and watcher) ─────────────

/** In-memory graph cache keyed by resolved project path */
const graphCache = new Map<string, CodeGraph>();

/** Invalidate graph cache for a project (called by watcher on file changes) */
export function invalidateGraphCache(projectPath: string): void {
  graphCache.delete(path.resolve(projectPath));
}

/** Get a cached graph, or load from Qdrant, or build one */
export async function getOrBuildGraph(
  projectPath: string,
  extraExtensions?: Set<string>,
): Promise<CodeGraph> {
  const resolved = path.resolve(projectPath);
  const cached = graphCache.get(resolved);
  if (cached) {
    return cached;
  }

  // Try loading persisted graph from Qdrant
  const projectId = projectIdFromPath(resolved);
  const graphCollName = graphCollectionName(projectId);
  const persisted = await loadGraphData(graphCollName);
  if (persisted) {
    graphCache.set(resolved, persisted);
    return persisted;
  }

  const graph = await buildCodeGraph(resolved, extraExtensions);
  graphCache.set(resolved, graph);
  return graph;
}

/** Force-rebuild, cache, and persist a graph.
 * If a build is already in progress for this project, returns the existing
 * in-flight promise (deduplication — same as indexer concurrency guard).
 */
export async function rebuildGraph(
  projectPath: string,
  extraExtensions?: Set<string>,
): Promise<CodeGraph> {
  const resolved = path.resolve(projectPath);

  // Concurrency guard: if already building, return the existing promise
  const existing = graphBuildPromises.get(resolved);
  if (existing) {
    logger.info("Graph build already in progress, joining existing build", { projectPath: resolved });
    return existing;
  }

  // Start tracked build
  const promise = doRebuildGraph(resolved, extraExtensions);
  graphBuildPromises.set(resolved, promise);

  try {
    const graph = await promise;
    return graph;
  } finally {
    graphBuildPromises.delete(resolved);
  }
}

/** Internal: performs the actual graph rebuild with progress tracking */
async function doRebuildGraph(
  resolvedPath: string,
  extraExtensions?: Set<string>,
): Promise<CodeGraph> {
  const progress: GraphBuildProgress = {
    startedAt: Date.now(),
    filesTotal: 0,
    filesProcessed: 0,
    phase: "scanning files",
  };
  graphBuildInProgress.set(resolvedPath, progress);

  try {
    graphCache.delete(resolvedPath);
    const graph = await buildCodeGraph(resolvedPath, extraExtensions, progress);
    graphCache.set(resolvedPath, graph);

    // Persist to Qdrant
    progress.phase = "persisting";
    const projectId = projectIdFromPath(resolvedPath);
    const graphCollName = graphCollectionName(projectId);
    await saveGraphData(graphCollName, resolvedPath, graph);

    lastGraphBuildCompleted.set(resolvedPath, {
      completedAt: Date.now(),
      durationMs: Date.now() - progress.startedAt,
      filesProcessed: progress.filesProcessed,
      nodesCreated: graph.nodes.length,
      edgesCreated: graph.edges.length,
    });

    return graph;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    progress.error = message;
    lastGraphBuildCompleted.set(resolvedPath, {
      completedAt: Date.now(),
      durationMs: Date.now() - progress.startedAt,
      filesProcessed: progress.filesProcessed,
      nodesCreated: 0,
      edgesCreated: 0,
      error: message,
    });
    throw err;
  } finally {
    graphBuildInProgress.delete(resolvedPath);
  }
}

/**
 * Wait for any in-flight graph build to finish for a project.
 * Resolves immediately if no build is in progress.
 * Swallows errors — the caller typically wants to proceed regardless.
 */
export async function awaitGraphBuild(projectPath: string): Promise<void> {
  const resolved = path.resolve(projectPath);
  const promise = graphBuildPromises.get(resolved);
  if (promise) {
    try { await promise; } catch { /* swallow — caller proceeds regardless */ }
  }
}

/** Remove a persisted code graph from Qdrant and clear cache */
export async function removeGraph(projectPath: string): Promise<void> {
  const resolved = path.resolve(projectPath);
  graphCache.delete(resolved);
  const projectId = projectIdFromPath(resolved);
  const graphCollName = graphCollectionName(projectId);
  await deleteGraphData(graphCollName);
  logger.info("Removed code graph", { projectPath: resolved });
}

/** Check if a graph exists (in cache or persisted) */
export async function hasGraph(projectPath: string): Promise<boolean> {
  const resolved = path.resolve(projectPath);
  if (graphCache.has(resolved)) return true;
  const projectId = projectIdFromPath(resolved);
  const graphCollName = graphCollectionName(projectId);
  const meta = await getGraphMetadata(graphCollName);
  return meta !== null;
}

/** Get graph metadata for status display */
export async function getGraphStatus(projectPath: string): Promise<{
  lastBuiltAt: string;
  nodeCount: number;
  edgeCount: number;
  cached: boolean;
} | null> {
  const resolved = path.resolve(projectPath);
  const projectId = projectIdFromPath(resolved);
  const graphCollName = graphCollectionName(projectId);
  const meta = await getGraphMetadata(graphCollName);
  if (!meta) return null;
  return {
    lastBuiltAt: meta.lastBuiltAt,
    nodeCount: meta.nodeCount,
    edgeCount: meta.edgeCount,
    cached: graphCache.has(resolved),
  };
}

// ── Register dynamic language grammars ───────────────────────────────────

let dynamicLangsRegistered = false;

export function ensureDynamicLanguages(): void {
  if (dynamicLangsRegistered) return;
  dynamicLangsRegistered = true;

  try {
    const langModules: Record<string, { libraryPath: string; extensions: string[]; languageSymbol?: string }> = {};

    const langPackages: Array<[string, string]> = [
      ["python",  "@ast-grep/lang-python"],
      ["go",      "@ast-grep/lang-go"],
      ["java",    "@ast-grep/lang-java"],
      ["rust",    "@ast-grep/lang-rust"],
      ["c",       "@ast-grep/lang-c"],
      ["cpp",     "@ast-grep/lang-cpp"],
      ["csharp",  "@ast-grep/lang-csharp"],
      ["ruby",    "@ast-grep/lang-ruby"],
      ["kotlin",  "@ast-grep/lang-kotlin"],
      ["swift",   "@ast-grep/lang-swift"],
      ["scala",   "@ast-grep/lang-scala"],
      ["bash",    "@ast-grep/lang-bash"],
      ["php",     "@ast-grep/lang-php"],
    ];

    for (const [name, pkg] of langPackages) {
      try {
        langModules[name] = esmRequire(pkg);
      } catch {
        // Language grammar not installed — skip silently
        logger.debug(`ast-grep language not available: ${name}`);
      }
    }

    if (Object.keys(langModules).length > 0) {
      registerDynamicLanguage(langModules);
      logger.info("Registered dynamic ast-grep languages", {
        languages: Object.keys(langModules),
      });
    }
  } catch (err) {
    logger.warn("Failed to register dynamic ast-grep languages", { error: String(err) });
  }
}

// ── Language mapping for ast-grep ────────────────────────────────────────

/** Map file extensions to ast-grep language identifiers */
export function getAstGrepLang(ext: string): Lang | string | null {
  const map: Record<string, Lang | string> = {
    // Dynamic languages (string identifiers)
    ".py": "python", ".pyw": "python", ".pyi": "python",
    ".java": "java",
    ".kt": "kotlin", ".kts": "kotlin",
    ".scala": "scala",
    ".c": "c", ".h": "c",
    ".cpp": "cpp", ".hpp": "cpp", ".cc": "cpp", ".hh": "cpp", ".cxx": "cpp",
    ".cs": "csharp",
    ".go": "go",
    ".rs": "rust",
    ".rb": "ruby",
    ".php": "php",
    ".swift": "swift",
    ".dart": "dart",
    ".lua": "lua",
    ".sh": "bash", ".bash": "bash", ".zsh": "bash",
    // Composite languages (parsed via HTML + script re-parse)
    ".svelte": "svelte",
    ".vue": "vue",
    // Built-in languages (Lang enum)
    ".js": Lang.JavaScript, ".jsx": Lang.JavaScript, ".mjs": Lang.JavaScript, ".cjs": Lang.JavaScript,
    ".ts": Lang.TypeScript,
    ".tsx": Lang.Tsx,
    ".html": Lang.Html, ".htm": Lang.Html,
    ".css": Lang.Css, ".scss": Lang.Css, ".sass": Lang.Css, ".less": Lang.Css, ".styl": Lang.Css,
  };
  return map[ext] ?? null;
}

// ── Graph building ───────────────────────────────────────────────────────

/**
 * Get all source files in a project for graph analysis.
 * Includes files with known AST grammars and any extra extensions.
 */
async function getGraphableFiles(
  projectPath: string,
  extraExts?: Set<string>,
): Promise<string[]> {
  const ig = createIgnoreFilter(projectPath);
  const extras = extraExts ?? EXTRA_EXTENSIONS;
  const files: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(projectPath, fullPath);

      if (shouldIgnore(ig, relPath)) continue;

      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        // Include if AST grammar is available OR if it's an extra extension
        if (getAstGrepLang(ext) !== null || extras.has(ext)) {
          files.push(relPath);
        }
      }
    }
  }

  await walk(projectPath);
  return files;
}

/**
 * Build a code graph for a project using ast-grep for polyglot support.
 * Files with extra extensions (no AST grammar) are included as leaf nodes
 * that can be targets of import edges from other files.
 */
export async function buildCodeGraph(
  projectPath: string,
  extraExtensions?: Set<string>,
  progress?: GraphBuildProgress,
): Promise<CodeGraph> {
  ensureDynamicLanguages();

  const resolvedPath = path.resolve(projectPath);
  const aliases = await loadPathAliases(resolvedPath);
  const files = await getGraphableFiles(resolvedPath, extraExtensions);
  const fileSet = new Set(files);

  if (progress) {
    progress.filesTotal = files.length;
    progress.phase = "analyzing imports";
  }

  logger.info("Building code graph", { projectPath: resolvedPath, fileCount: files.length });

  const nodesMap = new Map<string, CodeGraphNode>();
  const edges: CodeGraphEdge[] = [];

  // Build a suffix lookup map for JVM multi-module projects (Java/Kotlin/Scala).
  // This resolves FQNs like com.example.Foo when the class lives under a nested
  // src/main/java/ tree (e.g. module-a/sub/src/main/java/com/example/Foo.java).
  // Cost: O(n) once here, O(1) per import lookup — negligible vs. full AST parse.
  const hasJvm = files.some((f) => {
    const e = path.extname(f).toLowerCase();
    return e === ".java" || e === ".kt" || e === ".kts" || e === ".scala";
  });
  const jvmSuffixMap = hasJvm ? buildJvmSuffixMap(fileSet) : undefined;

  for (const relPath of files) {
    const ext = path.extname(relPath).toLowerCase();
    const lang = getAstGrepLang(ext);

    // Files with no AST grammar (extra extensions) are included as leaf nodes
    // so they can be targets of import edges from other files, but we skip
    // import extraction since we can't parse them.
    if (!lang) {
      const absolutePath = path.join(resolvedPath, relPath);
      if (!nodesMap.has(relPath)) {
        nodesMap.set(relPath, {
          filePath: absolutePath,
          relativePath: relPath,
          imports: [],
          exports: [],
          dependencies: [],
          dependents: [],
        });
      }
      if (progress) progress.filesProcessed++;
      continue;
    }

    const language = getLanguageFromExtension(ext);
    const absolutePath = path.join(resolvedPath, relPath);

    let source: string;
    try {
      const stat = await fs.stat(absolutePath);
      if (stat.size > MAX_GRAPH_FILE_BYTES) continue; // Skip large files
      source = await fs.readFile(absolutePath, "utf-8");
    } catch {
      continue;
    }

    // Create node for this file
    if (!nodesMap.has(relPath)) {
      nodesMap.set(relPath, {
        filePath: absolutePath,
        relativePath: relPath,
        imports: [],
        exports: [],
        dependencies: [],
        dependents: [],
      });
    }
    const node = nodesMap.get(relPath);
    if (!node) continue;

    // Extract imports using ast-grep
    const importInfos = extractImports(source, lang, ext);

    for (const imp of importInfos) {
      node.imports.push(imp.moduleSpecifier);

      // Try to resolve to a project file
      // CSS imports from <style> blocks use CSS resolution even when the source file is Svelte/Vue
      const resolutionLanguage = imp.isCssImport ? "css" : language;
      const resolved = resolveImport(imp.moduleSpecifier, absolutePath, resolvedPath, fileSet, resolutionLanguage, aliases, jvmSuffixMap);
      if (resolved) {
        node.dependencies.push(resolved);

        // Ensure target node exists
        if (!nodesMap.has(resolved)) {
          nodesMap.set(resolved, {
            filePath: path.join(resolvedPath, resolved),
            relativePath: resolved,
            imports: [],
            exports: [],
            dependencies: [],
            dependents: [],
          });
        }
        nodesMap.get(resolved)?.dependents.push(relPath);

        edges.push({
          source: relPath,
          target: resolved,
          type: imp.isDynamic ? "dynamic-import" : "import",
        });
      }
    }

    if (progress) progress.filesProcessed++;
  }

  logger.info("Code graph built", { nodes: nodesMap.size, edges: edges.length });

  return {
    nodes: Array.from(nodesMap.values()),
    edges,
  };
}
