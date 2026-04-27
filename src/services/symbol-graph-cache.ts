// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited

/**
 * In-memory `SymbolGraphCache` for a project. Backed by the sharded Qdrant
 * store in `symbol-graph-store.ts`.
 *
 * Loading strategy:
 *   - `meta`             — eager (tiny).
 *   - `nameIndex`        — eager on first symbol-name query (all 27 shards).
 *   - `reverseFileIndex` — eager on first impact query (all 256 shards).
 *   - `fileDataLru`      — lazy per-file payloads, LRU-bounded.
 *
 * Critical invariant: no query loads every symbol or every edge into memory.
 */

import { SYMBOL_FILE_LRU_SIZE, SYMBOL_REVERSE_SHARDS } from "../constants.js";
import type {
  SymbolGraphFilePayload,
  SymbolGraphMeta,
  SymbolRef,
} from "../types.js";
import { logger } from "./logger.js";
import {
  allNameShardKeys,
  loadFilePayload,
  loadNameShard,
  loadReverseShard,
  loadSymbolGraphMeta,
} from "./symbol-graph-store.js";

// ── Tiny LRU (handwritten, ~20 lines) ────────────────────────────────────

export class LRUCache<K, V> {
  private map = new Map<K, V>();
  constructor(private readonly capacity: number) {}

  get(key: K): V | undefined {
    const v = this.map.get(key);
    if (v === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value as K | undefined;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }

  keys(): IterableIterator<K> {
    return this.map.keys();
  }
}

// ── Cache structure ──────────────────────────────────────────────────────

export interface SymbolGraphCacheStats {
  fileLruSize: number;
  fileLruHits: number;
  fileLruMisses: number;
  nameIndexLoaded: boolean;
  reverseIndexLoaded: boolean;
}

export class SymbolGraphCache {
  meta: SymbolGraphMeta;
  /** name → list of symbol refs (lazy-loaded as a whole) */
  private nameIndex: Map<string, SymbolRef[]> | null = null;
  /** calleeFile → set of caller files (lazy-loaded as a whole) */
  private reverseFileIndex: Map<string, Set<string>> | null = null;
  /** lazy per-file payloads, LRU-bounded */
  fileDataLru: LRUCache<string, SymbolGraphFilePayload>;

  private stats: SymbolGraphCacheStats = {
    fileLruSize: 0,
    fileLruHits: 0,
    fileLruMisses: 0,
    nameIndexLoaded: false,
    reverseIndexLoaded: false,
  };

  constructor(
    public readonly projectId: string,
    meta: SymbolGraphMeta,
    lruCapacity: number = SYMBOL_FILE_LRU_SIZE,
  ) {
    this.meta = meta;
    this.fileDataLru = new LRUCache(lruCapacity);
  }

  /** Get the full name index, loading all shards on first access. */
  async getNameIndex(): Promise<Map<string, SymbolRef[]>> {
    if (this.nameIndex) return this.nameIndex;
    const merged = new Map<string, SymbolRef[]>();
    const shardKeys = allNameShardKeys();
    const shards = await Promise.all(
      shardKeys.map((k) => loadNameShard(this.projectId, k)),
    );
    for (const shard of shards) {
      if (!shard) continue;
      for (const [name, refs] of Object.entries(shard)) {
        const existing = merged.get(name);
        if (existing) {
          existing.push(...refs);
        } else {
          merged.set(name, [...refs]);
        }
      }
    }
    this.nameIndex = merged;
    this.stats.nameIndexLoaded = true;
    return merged;
  }

  /** Get the full reverse-call file index, loading all shards on first access. */
  async getReverseFileIndex(): Promise<Map<string, Set<string>>> {
    if (this.reverseFileIndex) return this.reverseFileIndex;
    const merged = new Map<string, Set<string>>();
    const buckets: number[] = [];
    for (let i = 0; i < SYMBOL_REVERSE_SHARDS; i++) buckets.push(i);
    const shards = await Promise.all(
      buckets.map((b) => loadReverseShard(this.projectId, b)),
    );
    for (const shard of shards) {
      if (!shard) continue;
      for (const [calleeFile, callerFiles] of Object.entries(shard)) {
        const existing = merged.get(calleeFile);
        if (existing) {
          for (const f of callerFiles) existing.add(f);
        } else {
          merged.set(calleeFile, new Set(callerFiles));
        }
      }
    }
    this.reverseFileIndex = merged;
    this.stats.reverseIndexLoaded = true;
    return merged;
  }

  /** Get a per-file payload, hitting the LRU first then Qdrant. */
  async getFilePayload(
    relativePath: string,
  ): Promise<SymbolGraphFilePayload | null> {
    const cached = this.fileDataLru.get(relativePath);
    if (cached) {
      this.stats.fileLruHits++;
      return cached;
    }
    this.stats.fileLruMisses++;
    const payload = await loadFilePayload(this.projectId, relativePath);
    if (payload) this.fileDataLru.set(relativePath, payload);
    this.stats.fileLruSize = this.fileDataLru.size;
    return payload;
  }

  /** Invalidate cached state for a file (called by watcher on file changes). */
  invalidateFile(relativePath: string): void {
    this.fileDataLru.delete(relativePath);
  }

  /** Patch the in-memory name index for an updated file payload. */
  patchNameIndexForFile(
    oldPayload: SymbolGraphFilePayload | null,
    newPayload: SymbolGraphFilePayload,
  ): void {
    if (!this.nameIndex) return;
    if (oldPayload) {
      for (const sym of oldPayload.symbols) {
        const refs = this.nameIndex.get(sym.name);
        if (!refs) continue;
        const filtered = refs.filter((r) => r.id !== sym.id);
        if (filtered.length === 0) this.nameIndex.delete(sym.name);
        else this.nameIndex.set(sym.name, filtered);
      }
    }
    for (const sym of newPayload.symbols) {
      const ref: SymbolRef = { file: sym.file, id: sym.id };
      const refs = this.nameIndex.get(sym.name);
      if (refs) refs.push(ref);
      else this.nameIndex.set(sym.name, [ref]);
    }
  }

  /** Patch the in-memory reverse-file index for an updated file payload. */
  patchReverseFileIndexForFile(
    oldPayload: SymbolGraphFilePayload | null,
    newPayload: SymbolGraphFilePayload,
  ): void {
    if (!this.reverseFileIndex) return;
    const callerFile = newPayload.file;
    if (oldPayload) {
      for (const e of oldPayload.outgoingCalls) {
        for (const calleeId of e.calleeCandidates) {
          const calleeFile = symbolIdToFile(calleeId);
          if (!calleeFile) continue;
          const callers = this.reverseFileIndex.get(calleeFile);
          if (!callers) continue;
          callers.delete(callerFile);
          if (callers.size === 0) this.reverseFileIndex.delete(calleeFile);
        }
      }
    }
    for (const e of newPayload.outgoingCalls) {
      for (const calleeId of e.calleeCandidates) {
        const calleeFile = symbolIdToFile(calleeId);
        if (!calleeFile) continue;
        const callers = this.reverseFileIndex.get(calleeFile);
        if (callers) callers.add(callerFile);
        else this.reverseFileIndex.set(calleeFile, new Set([callerFile]));
      }
    }
  }

  /** Replace the cached payload for a file (used after rebuild of one file). */
  setFilePayload(payload: SymbolGraphFilePayload): void {
    this.fileDataLru.set(payload.file, payload);
    this.stats.fileLruSize = this.fileDataLru.size;
  }

  getStats(): SymbolGraphCacheStats {
    return { ...this.stats, fileLruSize: this.fileDataLru.size };
  }
}

/** Extract the file portion from a SymbolNode.id (`file::qname#line`). */
export function symbolIdToFile(id: string): string | null {
  const idx = id.indexOf("::");
  return idx > 0 ? id.slice(0, idx) : null;
}

// ── Cache registry per project ───────────────────────────────────────────

const cacheRegistry = new Map<string, SymbolGraphCache>();
const cacheLoadPromises = new Map<string, Promise<SymbolGraphCache | null>>();

/** Get or build the cache for a project (loads meta from Qdrant lazily). */
export async function getSymbolGraphCache(
  projectId: string,
): Promise<SymbolGraphCache | null> {
  const cached = cacheRegistry.get(projectId);
  if (cached) return cached;

  const inFlight = cacheLoadPromises.get(projectId);
  if (inFlight) return inFlight;

  const promise = (async () => {
    const meta = await loadSymbolGraphMeta(projectId);
    if (!meta) return null;
    const cache = new SymbolGraphCache(projectId, meta);
    cacheRegistry.set(projectId, cache);
    return cache;
  })();

  cacheLoadPromises.set(projectId, promise);
  try {
    return await promise;
  } finally {
    cacheLoadPromises.delete(projectId);
  }
}

/** Replace (or insert) the cache for a project — used after a fresh rebuild. */
export function setSymbolGraphCache(cache: SymbolGraphCache): void {
  cacheRegistry.set(cache.projectId, cache);
}

/** Remove a project's cache from the registry. */
export function dropSymbolGraphCache(projectId: string): void {
  cacheRegistry.delete(projectId);
}

/** Reset all caches (testing only). */
export function resetSymbolGraphCacheRegistry(): void {
  cacheRegistry.clear();
  logger.debug("Symbol graph cache registry cleared");
}
