// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited
import { createHash } from "node:crypto";
import path from "node:path";

/**
 * Generate a stable project ID from an absolute folder path.
 * Uses a short SHA-256 prefix so collection names stay Qdrant-friendly.
 *
 * When `SOCRATICODE_PROJECT_ID` is set, that value is used directly instead
 * of hashing the path.  This lets multiple directory trees (e.g. git
 * worktrees) share a single Qdrant index.  The value must contain only
 * characters valid in a Qdrant collection name (`[a-zA-Z0-9_-]`).
 */
export function projectIdFromPath(folderPath: string): string {
  const explicit = process.env.SOCRATICODE_PROJECT_ID?.trim();
  if (explicit) {
    if (!/^[a-zA-Z0-9_-]+$/.test(explicit)) {
      throw new Error(
        `SOCRATICODE_PROJECT_ID must match [a-zA-Z0-9_-]+ but got: "${explicit}"`,
      );
    }
    return explicit;
  }
  const normalized = path.resolve(folderPath);
  return createHash("sha256").update(normalized).digest("hex").slice(0, 12);
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
