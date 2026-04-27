// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited

/**
 * Impact / flow / context analysis on top of the `SymbolGraphCache`.
 * No monolithic graph object — every traversal goes through indices and
 * lazy-loaded per-file payloads.
 */

import { MAX_FLOW_DEPTH, MAX_IMPACT_DEPTH } from "../constants.js";
import type { SymbolNode } from "../types.js";
import {
  type SymbolGraphCache,
  symbolIdToFile,
} from "./symbol-graph-cache.js";

// ── Impact (blast radius) ────────────────────────────────────────────────

export interface ImpactResult {
  target: string;
  targetKind: "file" | "symbol";
  depth: number;
  /** Files grouped by hop distance (1 = direct caller, 2 = caller of caller, ...) */
  filesByDepth: Map<number, string[]>;
  totalFiles: number;
  truncated: boolean;
}

/** BFS over the in-memory `reverseFileIndex`. Polymorphic on target type. */
export async function getImpactRadius(
  cache: SymbolGraphCache,
  target: string,
  depth: number = 3,
): Promise<ImpactResult> {
  const safeDepth = Math.max(1, Math.min(depth, MAX_IMPACT_DEPTH));
  const reverseIndex = await cache.getReverseFileIndex();

  const targetKind: "file" | "symbol" = looksLikeFilePath(target)
    ? "file"
    : "symbol";

  // Resolve to one or more "seed" files
  let seedFiles: Set<string>;
  if (targetKind === "file") {
    seedFiles = new Set([target]);
  } else {
    seedFiles = new Set();
    const nameIndex = await cache.getNameIndex();
    const refs = nameIndex.get(target) ?? [];
    for (const r of refs) seedFiles.add(r.file);
  }

  const visited = new Set<string>();
  const filesByDepth = new Map<number, string[]>();
  let frontier = new Set(seedFiles);
  for (const f of seedFiles) visited.add(f);

  let truncated = false;
  for (let hop = 1; hop <= safeDepth; hop++) {
    const next = new Set<string>();
    for (const calleeFile of frontier) {
      const callers = reverseIndex.get(calleeFile);
      if (!callers) continue;
      for (const callerFile of callers) {
        if (visited.has(callerFile)) continue;
        next.add(callerFile);
        visited.add(callerFile);
      }
    }
    if (next.size === 0) break;
    filesByDepth.set(hop, Array.from(next).sort());
    frontier = next;
    // After reaching the depth limit, check if more callers exist beyond it.
    if (hop === safeDepth) {
      for (const calleeFile of frontier) {
        const callers = reverseIndex.get(calleeFile);
        if (!callers) continue;
        for (const callerFile of callers) {
          if (!visited.has(callerFile)) {
            truncated = true;
            break;
          }
        }
        if (truncated) break;
      }
    }
  }

  let totalFiles = 0;
  for (const arr of filesByDepth.values()) totalFiles += arr.length;
  return {
    target, targetKind, depth: safeDepth, filesByDepth, totalFiles,
    truncated,
  };
}

// ── Call flow (forward DFS) ──────────────────────────────────────────────

export interface FlowNode {
  symbolId: string;
  symbolName: string;
  file: string;
  line: number;
  children: FlowNode[];
  /** True if the recursion stopped here due to depth or cycle. */
  truncatedReason?: "depth" | "cycle";
}

/** DFS via lazy-loaded outgoing edges, cycle-safe. */
export async function getCallFlow(
  cache: SymbolGraphCache,
  entrypointId: string,
  depth: number = 5,
): Promise<FlowNode | null> {
  const safeDepth = Math.max(1, Math.min(depth, MAX_FLOW_DEPTH));
  const file = symbolIdToFile(entrypointId);
  if (!file) return null;
  const payload = await cache.getFilePayload(file);
  if (!payload) return null;
  const sym = payload.symbols.find((s) => s.id === entrypointId);
  if (!sym) return null;

  const visited = new Set<string>();
  return await walk(cache, sym, 0, safeDepth, visited);
}

async function walk(
  cache: SymbolGraphCache,
  sym: SymbolNode,
  hop: number,
  maxDepth: number,
  visited: Set<string>,
): Promise<FlowNode> {
  const node: FlowNode = {
    symbolId: sym.id,
    symbolName: sym.qualifiedName,
    file: sym.file,
    line: sym.line,
    children: [],
  };
  if (visited.has(sym.id)) {
    node.truncatedReason = "cycle";
    return node;
  }
  visited.add(sym.id);
  if (hop >= maxDepth) {
    node.truncatedReason = "depth";
    return node;
  }

  const payload = await cache.getFilePayload(sym.file);
  if (!payload) return node;

  const calls = payload.outgoingCalls.filter(
    (e) => e.callerId === sym.id && e.calleeCandidates.length > 0,
  );

  for (const e of calls) {
    for (const calleeId of e.calleeCandidates) {
      const calleeFile = symbolIdToFile(calleeId);
      if (!calleeFile) continue;
      const calleePayload = await cache.getFilePayload(calleeFile);
      if (!calleePayload) continue;
      const calleeSym = calleePayload.symbols.find((s) => s.id === calleeId);
      if (!calleeSym) continue;
      node.children.push(await walk(cache, calleeSym, hop + 1, maxDepth, visited));
    }
  }
  return node;
}

// ── Symbol context (360° view) ───────────────────────────────────────────

export interface SymbolContext {
  symbol: SymbolNode;
  callers: Array<{ file: string; line: number; symbolId: string }>;
  callees: Array<{ name: string; resolved: string[]; confidence: string }>;
}

export async function getSymbolContext(
  cache: SymbolGraphCache,
  name: string,
  fileHint?: string,
): Promise<SymbolContext[]> {
  const nameIndex = await cache.getNameIndex();
  let refs = nameIndex.get(name) ?? [];
  if (fileHint) refs = refs.filter((r) => r.file === fileHint);
  if (refs.length === 0) return [];

  const reverseIndex = await cache.getReverseFileIndex();
  const out: SymbolContext[] = [];

  for (const ref of refs) {
    const payload = await cache.getFilePayload(ref.file);
    if (!payload) continue;
    const sym = payload.symbols.find((s) => s.id === ref.id);
    if (!sym) continue;

    // Callees: edges originating from this symbol
    const callees: SymbolContext["callees"] = payload.outgoingCalls
      .filter((e) => e.callerId === sym.id)
      .map((e) => ({
        name: e.calleeName,
        resolved: e.calleeCandidates,
        confidence: e.confidence,
      }));

    // Callers: scan callerFiles' outgoingCalls for edges pointing at this symbol
    const callerFiles = reverseIndex.get(ref.file) ?? new Set();
    const callers: SymbolContext["callers"] = [];
    for (const cf of callerFiles) {
      const cp = await cache.getFilePayload(cf);
      if (!cp) continue;
      for (const e of cp.outgoingCalls) {
        if (e.calleeCandidates.includes(sym.id)) {
          callers.push({
            file: e.callSite.file,
            line: e.callSite.line,
            symbolId: e.callerId,
          });
        }
      }
    }

    out.push({ symbol: sym, callers, callees });
  }
  return out;
}

// ── List symbols ─────────────────────────────────────────────────────────

export async function listSymbols(
  cache: SymbolGraphCache,
  opts: { file?: string; query?: string; limit?: number },
): Promise<SymbolNode[]> {
  const limit = opts.limit ?? 200;
  const out: SymbolNode[] = [];

  if (opts.file) {
    const payload = await cache.getFilePayload(opts.file);
    if (!payload) return [];
    for (const s of payload.symbols) {
      if (s.name === "<module>") continue;
      out.push(s);
      if (out.length >= limit) break;
    }
    return out;
  }

  const nameIndex = await cache.getNameIndex();
  const q = opts.query?.toLowerCase() ?? "";
  for (const [name, refs] of nameIndex.entries()) {
    if (q && !name.toLowerCase().includes(q)) continue;
    for (const r of refs) {
      const payload = await cache.getFilePayload(r.file);
      if (!payload) continue;
      const sym = payload.symbols.find((s) => s.id === r.id);
      if (sym) out.push(sym);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

// ── Helpers ──────────────────────────────────────────────────────────────

/** Detect whether a target string looks like a file path vs a symbol name. */
export function looksLikeFilePath(s: string): boolean {
  return s.includes("/") || s.includes("\\") || /\.[a-z]{1,5}$/i.test(s);
}
