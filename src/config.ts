// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// ── Branch detection ─────────────────────────────────────────────────────

/**
 * Detect the current git branch for a project path.
 * Returns `null` if the path is not inside a git repository or detection fails.
 */
export function detectGitBranch(projectPath: string): string | null {
  try {
    const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: path.resolve(projectPath),
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    // "HEAD" is returned for detached HEAD state — treat as no branch
    return branch && branch !== "HEAD" ? branch : null;
  } catch {
    return null;
  }
}

/**
 * Sanitize a git branch name for use in Qdrant collection names.
 * Replaces characters outside `[a-zA-Z0-9_-]` with underscores,
 * collapses consecutive underscores, and strips leading/trailing underscores.
 */
export function sanitizeBranchName(branch: string): string {
  return branch
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

/** Pattern of characters valid in a Qdrant collection name suffix. */
const PROJECT_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

/** Validate an explicitly-supplied projectId. Throws on bad characters. */
function assertValidProjectId(value: string, source: string): void {
  if (!PROJECT_ID_PATTERN.test(value)) {
    throw new Error(`${source} must match [a-zA-Z0-9_-]+ but got: "${value}"`);
  }
}

/**
 * Read and validate `projectId` from `.socraticode.json`, if present.
 *
 * Returns the trimmed id when the file declares a usable string, `null`
 * otherwise (file missing, malformed JSON, field absent, wrong type, or
 * empty after trim). Throws when the field is a string with characters
 * outside the Qdrant-friendly set — explicit user intent fails loud.
 */
function readProjectIdFromConfigFile(folderPath: string): string | null {
  const config = loadSocratiCodeConfig(folderPath);
  if (!config || typeof config.projectId !== "string") return null;
  const trimmed = config.projectId.trim();
  if (!trimmed) return null;
  assertValidProjectId(trimmed, ".socraticode.json: projectId");
  return trimmed;
}

/**
 * Generate a stable project ID from an absolute folder path.
 * Uses a short SHA-256 prefix so collection names stay Qdrant-friendly.
 *
 * Resolution order (highest precedence first):
 *   1. `SOCRATICODE_PROJECT_ID` env var — per-machine override.
 *   2. `projectId` in `.socraticode.json` — committed, shared across the
 *      team so every checkout addresses the same Qdrant collection
 *      regardless of where the working tree lives on disk.
 *   3. SHA-256 prefix of the resolved absolute path — default fallback.
 *
 * In both override paths the value must match `[a-zA-Z0-9_-]+`; invalid
 * characters throw. Whitespace is trimmed; empty/whitespace-only values
 * fall through to the next level.
 *
 * When `SOCRATICODE_BRANCH_AWARE` is `"true"` (and no explicit project ID
 * is set via env var or config file), the current git branch name is
 * appended to the hash, producing a separate set of collections per
 * branch.
 */
export function projectIdFromPath(folderPath: string): string {
  const envExplicit = process.env.SOCRATICODE_PROJECT_ID?.trim();
  if (envExplicit) {
    assertValidProjectId(envExplicit, "SOCRATICODE_PROJECT_ID");
    return envExplicit;
  }

  const fileExplicit = readProjectIdFromConfigFile(folderPath);
  if (fileExplicit) {
    return fileExplicit;
  }

  let id = coreProjectId(folderPath);

  // Branch-aware mode: append sanitized branch name to isolate per-branch indexes
  if (process.env.SOCRATICODE_BRANCH_AWARE === "true") {
    const branch = detectGitBranch(path.resolve(folderPath));
    if (branch) {
      const sanitized = sanitizeBranchName(branch);
      if (sanitized) {
        id = `${id}__${sanitized}`;
      }
    }
  }

  return id;
}

/**
 * Core project ID: SHA-256 hash of the resolved path, without branch suffix.
 * Used as the default fallback when no explicit project ID is configured.
 */
function coreProjectId(folderPath: string): string {
  const normalized = path.resolve(folderPath);
  return createHash("sha256").update(normalized).digest("hex").slice(0, 12);
}

/**
 * Branch-suffix-free, env-var-free project ID for a given path.
 *
 * Resolution: `projectId` from `.socraticode.json` if present, else the
 * SHA-256 path hash. Used for linked projects (where `SOCRATICODE_PROJECT_ID`
 * is process-scoped and ambiguous when applied to a different project) and
 * for dedup keys in `resolveLinkedCollections` (where we need a stable
 * identity that doesn't drift across branches).
 */
function effectiveBaseProjectId(folderPath: string): string {
  const fileId = readProjectIdFromConfigFile(folderPath);
  return fileId ?? coreProjectId(folderPath);
}

/**
 * Derive a Qdrant collection name for a project's code chunks.
 */
export function collectionName(projectId: string): string {
  return `codebase_${projectId}`;
}

/**
 * Derive a Qdrant collection name for a project's code graph.
 */
export function graphCollectionName(projectId: string): string {
  return `codegraph_${projectId}`;
}

/**
 * Derive a Qdrant collection name for a project's context artifacts.
 */
export function contextCollectionName(projectId: string): string {
  return `context_${projectId}`;
}

// ── Symbol graph collections ─────────────────────────────────────────────

/** Top-level metadata point for a project's symbol graph. */
export function symgraphMetaCollectionName(projectId: string): string {
  return `${projectId}_symgraph_meta`;
}

/** Per-file payloads for a project's symbol graph. */
export function symgraphFileCollectionName(projectId: string): string {
  return `${projectId}_symgraph_file`;
}

/** Sharded indices (name index + reverse-call file index). */
export function symgraphIndexCollectionName(projectId: string): string {
  return `${projectId}_symgraph_index`;
}

// ── Linked projects ──────────────────────────────────────────────────────

/** Configuration file name shared by all `.socraticode.json` consumers. */
const SOCRATICODE_CONFIG_FILE = ".socraticode.json";

/**
 * Shape of `.socraticode.json`.
 *
 * Fields are typed as their intended shape; runtime validators in the
 * consumers tolerate malformed values (wrong type, null, etc.) so the
 * MCP server stays resilient against hand-edited config files.
 */
interface SocratiCodeConfig {
  /**
   * Stable project identifier shared across machines/checkouts.
   * When set, overrides the path-hash default so every team member
   * addresses the same Qdrant collection regardless of where the
   * working tree lives on disk. The env var
   * `SOCRATICODE_PROJECT_ID` takes precedence over this field.
   */
  projectId?: string;
  /** Paths (absolute or relative to this file) of related projects to search alongside this one. */
  linkedProjects?: string[];
}

/**
 * Read and parse `.socraticode.json` from a project directory.
 *
 * Returns the parsed object or `null` when the file is missing,
 * unreadable, or contains malformed JSON. Per-field validation is the
 * caller's responsibility — this loader only handles I/O and parsing.
 */
function loadSocratiCodeConfig(projectPath: string): SocratiCodeConfig | null {
  const configPath = path.join(path.resolve(projectPath), SOCRATICODE_CONFIG_FILE);
  try {
    if (!fs.existsSync(configPath)) return null;
    const raw = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(raw) as SocratiCodeConfig;
  } catch {
    return null;
  }
}

/**
 * Load linked project paths from `.socraticode.json` and/or the
 * `SOCRATICODE_LINKED_PROJECTS` env var (comma-separated absolute or relative paths).
 *
 * Returns resolved absolute paths. Invalid/missing paths are silently skipped.
 */
export function loadLinkedProjects(projectPath: string): string[] {
  const resolvedRoot = path.resolve(projectPath);
  const paths = new Set<string>();

  // 1. Read .socraticode.json
  const config = loadSocratiCodeConfig(resolvedRoot);
  if (config && Array.isArray(config.linkedProjects)) {
    for (const p of config.linkedProjects) {
      if (typeof p === "string" && p.trim()) {
        const resolved = path.resolve(resolvedRoot, p.trim());
        if (resolved !== resolvedRoot && fs.existsSync(resolved)) {
          paths.add(resolved);
        }
      }
    }
  }

  // 2. Read env var (comma-separated)
  const envLinked = process.env.SOCRATICODE_LINKED_PROJECTS?.trim();
  if (envLinked) {
    for (const p of envLinked.split(",")) {
      const trimmed = p.trim();
      if (trimmed) {
        const resolved = path.resolve(resolvedRoot, trimmed);
        if (resolved !== resolvedRoot && fs.existsSync(resolved)) {
          paths.add(resolved);
        }
      }
    }
  }

  return Array.from(paths);
}

/**
 * Resolve linked projects into Qdrant collection descriptors for multi-collection search.
 * Returns an array of { name, label } suitable for `searchMultipleCollections()`.
 * The current project is always first (highest priority for dedup).
 *
 * Linked-project IDs are resolved via `effectiveBaseProjectId`, which honors
 * each linked project's own `.socraticode.json` `projectId` field. This
 * preserves symmetry — a project addresses the same Qdrant collection whether
 * it is the current root or a linked dependency from another project.
 *
 * Dedup compares against the *current project's full ID* (env override → file
 * → path-hash, with optional branch suffix). This guarantees the dedup key
 * matches the actual collection name being added: a linked project is skipped
 * only when it would resolve to the same collection that the current project
 * already occupies. Seeding from `effectiveBaseProjectId(resolvedRoot)` would
 * misalign the seed when `SOCRATICODE_PROJECT_ID` is set, causing linked
 * projects whose file `projectId` happens to match the current project's file
 * `projectId` to be silently dropped even though their data lives in a
 * different collection than the env-overridden current one.
 */
export function resolveLinkedCollections(
  projectPath: string,
): Array<{ name: string; label: string }> {
  const resolvedRoot = path.resolve(projectPath);
  const currentId = projectIdFromPath(resolvedRoot);
  const seen = new Set<string>([currentId]);
  const collections: Array<{ name: string; label: string }> = [
    { name: collectionName(currentId), label: path.basename(resolvedRoot) },
  ];

  for (const linkedPath of loadLinkedProjects(resolvedRoot)) {
    const linkedId = effectiveBaseProjectId(linkedPath);
    if (seen.has(linkedId)) continue;
    seen.add(linkedId);
    collections.push({
      name: collectionName(linkedId),
      label: path.basename(linkedPath),
    });
  }

  return collections;
}
