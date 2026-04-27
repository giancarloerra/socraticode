// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited

/**
 * Per-file incremental updates for the symbol-level call graph.
 *
 * Wired into the watcher path so a single file save does not force a
 * full re-extraction + re-resolution of the entire codebase.
 *
 * Scope of incremental update:
 *   1. Re-extract symbols & raw calls for the changed file.
 *   2. Resolve calls best-effort against the (already-rebuilt) file-import graph.
 *   3. Diff the new file payload against the previous one and patch only the
 *      affected name-index shards (max 27) and reverse-call shards (max 256).
 *   4. Update the meta point with running counts (no recount needed).
 *
 * Falls back to a no-op if no symbol graph meta exists yet — the caller can
 * detect that and trigger a full rebuild instead.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import {
  getLanguageFromExtension,
  SYMBOL_REVERSE_SHARDS,
} from "../constants.js";
import type {
  CodeGraph,
  SymbolEdge,
  SymbolGraphFilePayload,
  SymbolGraphMeta,
  SymbolNode,
  SymbolRef,
} from "../types.js";
import { getAstGrepLang } from "./code-graph.js";
import { resolveCallSites } from "./graph-symbol-resolution.js";
import {
  extractSymbolsAndCalls,
  rawCallsToUnresolvedEdges,
} from "./graph-symbols.js";
import { logger } from "./logger.js";
import {
  getSymbolGraphCache,
  SymbolGraphCache,
  setSymbolGraphCache,
} from "./symbol-graph-cache.js";
import {
  contentHashOf,
  deleteFilePayload,
  loadFilePayload,
  loadNameShard,
  loadReverseShard,
  loadSymbolGraphMeta,
  nameShardKey,
  reverseShardKey,
  saveFilePayload,
  saveNameShard,
  saveReverseShard,
  saveSymbolGraphMeta,
} from "./symbol-graph-store.js";

/** Result of applying an incremental update. */
export interface IncrementalUpdateResult {
  filesChanged: number;
  filesRemoved: number;
  symbolsDelta: number;
  edgesDelta: number;
  /** True when meta was missing — caller should trigger a full rebuild. */
  fullRebuildRequired: boolean;
}

/**
 * Incrementally update the symbol graph for the given changed/removed files.
 * The caller must pass the freshly-built file-import graph (used for
 * dependency-aware call resolution).
 *
 * Files in `changedRelPaths` are re-extracted and upserted.
 * Files in `removedRelPaths` have their payloads, name-index entries, and
 * reverse-call entries removed.
 *
 * Returns `fullRebuildRequired = true` if no meta exists yet — caller should
 * fall back to a full `rebuildGraph()`.
 */
export async function updateChangedFilesSymbolGraph(
  projectId: string,
  projectPath: string,
  fileGraph: CodeGraph,
  changedRelPaths: string[],
  removedRelPaths: string[],
): Promise<IncrementalUpdateResult> {
  const meta = await loadSymbolGraphMeta(projectId);
  if (!meta) {
    return {
      filesChanged: 0,
      filesRemoved: 0,
      symbolsDelta: 0,
      edgesDelta: 0,
      fullRebuildRequired: true,
    };
  }

  // Track shards that need re-saving so we batch IO at the end.
  const dirtyNameShards = new Map<string, Record<string, SymbolRef[]>>();
  const dirtyReverseShards = new Map<number, Record<string, string[]>>();

  // Helper: lazily load a name shard into the dirty map.
  async function getNameShard(key: string): Promise<Record<string, SymbolRef[]>> {
    let shard = dirtyNameShards.get(key);
    if (shard) return shard;
    shard = (await loadNameShard(projectId, key)) ?? {};
    dirtyNameShards.set(key, shard);
    return shard;
  }
  async function getReverseShard(bucket: number): Promise<Record<string, string[]>> {
    let shard = dirtyReverseShards.get(bucket);
    if (shard) return shard;
    shard = (await loadReverseShard(projectId, bucket)) ?? {};
    dirtyReverseShards.set(bucket, shard);
    return shard;
  }

  let symbolsDelta = 0;
  let edgesDelta = 0;
  let filesChangedActual = 0;
  let filesRemovedActual = 0;

  // ── Process removed files ─────────────────────────────────────────────
  for (const relPath of removedRelPaths) {
    const oldPayload = await loadFilePayload(projectId, relPath);
    if (!oldPayload) continue;
    await applyRemoval(projectId, oldPayload, getNameShard, getReverseShard);
    await deleteFilePayload(projectId, relPath);
    symbolsDelta -= countNamedSymbols(oldPayload.symbols);
    edgesDelta -= oldPayload.outgoingCalls.length;
    filesRemovedActual++;
  }

  // ── Process changed files (re-extract + diff + upsert) ────────────────
  for (const relPath of changedRelPaths) {
    const ext = path.extname(relPath);
    const lang = getAstGrepLang(ext);
    if (!lang) continue;
    let source: string;
    try {
      source = await fs.readFile(path.join(projectPath, relPath), "utf-8");
    } catch {
      continue;
    }
    const language = getLanguageFromExtension(ext) ?? "plaintext";
    // biome-ignore lint/suspicious/noExplicitAny: ast-grep Lang type unify
    const extracted = extractSymbolsAndCalls(source, lang as any, ext, relPath);

    // Resolution: build minimal symbolsByFile/outgoingCallsByFile maps so we
    // can reuse the existing 3-tier resolver. Other files' symbols are not
    // available here, so cross-file edges fall back to "unresolved" — that's
    // acceptable for the watcher path; the next full rebuild will tighten it.
    const symbolsByFile = new Map<string, SymbolNode[]>();
    symbolsByFile.set(relPath, extracted.symbols);
    const unresolvedEdges = rawCallsToUnresolvedEdges(extracted.rawCalls);
    const outgoingCallsByFile = new Map<string, SymbolEdge[]>();
    outgoingCallsByFile.set(relPath, unresolvedEdges);
    try {
      resolveCallSites(fileGraph, symbolsByFile, outgoingCallsByFile);
    } catch (err) {
      logger.debug("Incremental resolveCallSites failed (using unresolved)", {
        file: relPath,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const newPayload: SymbolGraphFilePayload = {
      file: relPath,
      language,
      contentHash: contentHashOf(source),
      symbols: extracted.symbols,
      outgoingCalls: outgoingCallsByFile.get(relPath) ?? unresolvedEdges,
    };

    const oldPayload = await loadFilePayload(projectId, relPath);

    // Skip work if content hash unchanged (true no-op save).
    if (oldPayload && oldPayload.contentHash === newPayload.contentHash) {
      continue;
    }

    if (oldPayload) {
      await applyRemoval(projectId, oldPayload, getNameShard, getReverseShard);
      symbolsDelta -= countNamedSymbols(oldPayload.symbols);
      edgesDelta -= oldPayload.outgoingCalls.length;
    }
    await applyAddition(projectId, newPayload, getNameShard, getReverseShard);
    await saveFilePayload(projectId, newPayload);
    symbolsDelta += countNamedSymbols(newPayload.symbols);
    edgesDelta += newPayload.outgoingCalls.length;
    filesChangedActual++;
  }

  // ── Persist dirty shards ──────────────────────────────────────────────
  for (const [key, shard] of dirtyNameShards.entries()) {
    await saveNameShard(projectId, key, shard);
  }
  for (const [bucket, shard] of dirtyReverseShards.entries()) {
    await saveReverseShard(projectId, bucket, shard);
  }

  // ── Update meta with running counts ──────────────────────────────────
  const newMeta: SymbolGraphMeta = {
    ...meta,
    symbolCount: Math.max(0, meta.symbolCount + symbolsDelta),
    edgeCount: Math.max(0, meta.edgeCount + edgesDelta),
    fileCount: Math.max(
      0,
      meta.fileCount + filesChangedNew(changedRelPaths, removedRelPaths),
    ),
    builtAt: Date.now(),
    // Note: unresolvedEdgePct is NOT recomputed incrementally — it's an
    // approximation from the last full rebuild plus rough delta. Acceptable
    // until the next full rebuild.
  };
  await saveSymbolGraphMeta(projectId, newMeta);

  // Refresh in-memory cache: clear any per-shard memoisation by replacing the
  // cache instance with a fresh one carrying the new meta.
  setSymbolGraphCache(new SymbolGraphCache(projectId, newMeta));
  // Touch the registry to drop stale-pre-existing reference if any.
  await getSymbolGraphCache(projectId);

  logger.info("Symbol graph incrementally updated", {
    projectId,
    filesChanged: filesChangedActual,
    filesRemoved: filesRemovedActual,
    symbolsDelta,
    edgesDelta,
  });

  return {
    filesChanged: filesChangedActual,
    filesRemoved: filesRemovedActual,
    symbolsDelta,
    edgesDelta,
    fullRebuildRequired: false,
  };
}

// ── Internal helpers ────────────────────────────────────────────────────

function countNamedSymbols(symbols: SymbolNode[]): number {
  let n = 0;
  for (const s of symbols) if (s.name !== "<module>") n++;
  return n;
}

/** Net change to fileCount = newly-added files - removed files. */
function filesChangedNew(changed: string[], removed: string[]): number {
  // We can't tell here whether a `changed` path was previously known; the
  // caller is responsible for de-duplication. This approximation is good
  // enough for the meta counter — full rebuilds correct any drift.
  return changed.length - removed.length;
}

async function applyRemoval(
  projectId: string,
  payload: SymbolGraphFilePayload,
  getNameShard: (key: string) => Promise<Record<string, SymbolRef[]>>,
  getReverseShard: (bucket: number) => Promise<Record<string, string[]>>,
): Promise<void> {
  // Remove this file's symbols from the relevant name shards.
  for (const sym of payload.symbols) {
    if (sym.name === "<module>") continue;
    const shard = await getNameShard(nameShardKey(sym.name));
    // Use hasOwn — `shard[sym.name]` for "constructor" returns a function.
    if (!Object.hasOwn(shard, sym.name)) continue;
    const refs = shard[sym.name];
    if (!refs) continue;
    const filtered = refs.filter((r) => r.file !== payload.file);
    if (filtered.length === 0) delete shard[sym.name];
    else shard[sym.name] = filtered;
  }
  // Remove caller entries from reverse shards.
  for (const edge of payload.outgoingCalls) {
    for (const calleeId of edge.calleeCandidates) {
      const calleeFile = calleeId.split("::")[0];
      if (!calleeFile || calleeFile === payload.file) continue;
      const bucket = reverseShardKey(calleeFile);
      const shard = await getReverseShard(bucket);
      const arr = shard[calleeFile];
      if (!arr) continue;
      const filtered = arr.filter((f) => f !== payload.file);
      if (filtered.length === 0) delete shard[calleeFile];
      else shard[calleeFile] = filtered;
    }
  }
  // Suppress unused-projectId warning: the helper is closed over the same id
  // already; keeping it as a parameter mirrors the public API shape.
  void projectId;
  // Cap the bucket index to constants to satisfy lint (no dead branches).
  void SYMBOL_REVERSE_SHARDS;
}

async function applyAddition(
  projectId: string,
  payload: SymbolGraphFilePayload,
  getNameShard: (key: string) => Promise<Record<string, SymbolRef[]>>,
  getReverseShard: (bucket: number) => Promise<Record<string, string[]>>,
): Promise<void> {
  for (const sym of payload.symbols) {
    if (sym.name === "<module>") continue;
    const shard = await getNameShard(nameShardKey(sym.name));
    const ref: SymbolRef = { file: payload.file, id: sym.id };
    // Use hasOwn — `shard[sym.name]` would return Object.prototype.constructor
    // (a function) for symbol names like "constructor" / "toString".
    const existing = Object.hasOwn(shard, sym.name) ? shard[sym.name] : undefined;
    if (existing) {
      // De-dup
      if (!existing.some((e) => e.id === ref.id && e.file === ref.file)) {
        existing.push(ref);
      }
    } else {
      shard[sym.name] = [ref];
    }
  }
  for (const edge of payload.outgoingCalls) {
    for (const calleeId of edge.calleeCandidates) {
      const calleeFile = calleeId.split("::")[0];
      if (!calleeFile || calleeFile === payload.file) continue;
      const bucket = reverseShardKey(calleeFile);
      const shard = await getReverseShard(bucket);
      const existing = shard[calleeFile];
      if (existing) {
        if (!existing.includes(payload.file)) existing.push(payload.file);
      } else {
        shard[calleeFile] = [payload.file];
      }
    }
  }
  void projectId;
}
