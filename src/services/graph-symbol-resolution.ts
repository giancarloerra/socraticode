// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited

/**
 * Cross-file call-site resolution. Given a file-import graph (from
 * `code-graph.ts`) and the per-file extracted symbols, populates each call
 * edge's `calleeCandidates` and `confidence`.
 *
 * Strategy (uniform across languages):
 *   1. Local — callee name matches a symbol in the caller's own file
 *   2. Imported — walk caller's file `dependencies` from the file graph;
 *      any dependency exposing a same-named symbol is a candidate
 *   3. Wildcard / re-export — barrel files re-export symbols transitively;
 *      we do one extra hop through dependency files
 *   4. Resolution: 0 → "unresolved", 1 → "unique", >1 → "multiple-candidates"
 *
 * No type inference. Method calls resolve by name only.
 */

import type { CodeGraph, SymbolEdge, SymbolNode } from "../types.js";

/**
 * Resolve all call sites for every file in `symbolsByFile`. Mutates the
 * passed-in `outgoingCallsByFile` edges in place.
 */
export function resolveCallSites(
  fileGraph: CodeGraph,
  symbolsByFile: Map<string, SymbolNode[]>,
  outgoingCallsByFile: Map<string, SymbolEdge[]>,
): void {
  // Build a fast lookup: file → Map<symbolName, SymbolNode[]>
  const symbolIndexByFile = new Map<string, Map<string, SymbolNode[]>>();
  for (const [file, syms] of symbolsByFile.entries()) {
    const idx = new Map<string, SymbolNode[]>();
    for (const s of syms) {
      if (s.name === "<module>") continue;
      const existing = idx.get(s.name);
      if (existing) existing.push(s);
      else idx.set(s.name, [s]);
    }
    symbolIndexByFile.set(file, idx);
  }

  // Build file → dependency files (1-hop from the file-import graph)
  const depsByFile = new Map<string, string[]>();
  for (const node of fileGraph.nodes) {
    depsByFile.set(node.relativePath, node.dependencies.slice());
  }

  for (const [callerFile, edges] of outgoingCallsByFile.entries()) {
    const localIdx = symbolIndexByFile.get(callerFile);
    const deps = depsByFile.get(callerFile) ?? [];

    for (const edge of edges) {
      const candidates: string[] = [];

      // 1. Local
      const local = localIdx?.get(edge.calleeName);
      if (local && local.length > 0) {
        for (const s of local) candidates.push(s.id);
        edge.calleeCandidates = candidates;
        edge.confidence = "local";
        continue;
      }

      // 2. Imported (walk direct dependencies)
      for (const dep of deps) {
        const depIdx = symbolIndexByFile.get(dep);
        const matches = depIdx?.get(edge.calleeName);
        if (matches) for (const s of matches) candidates.push(s.id);
      }

      // 3. Wildcard / re-export — one extra hop through dep files
      if (candidates.length === 0) {
        for (const dep of deps) {
          const transitive = depsByFile.get(dep) ?? [];
          for (const t of transitive) {
            if (t === callerFile) continue;
            const tIdx = symbolIndexByFile.get(t);
            const matches = tIdx?.get(edge.calleeName);
            if (matches) for (const s of matches) candidates.push(s.id);
          }
        }
      }

      // De-duplicate
      const uniq = Array.from(new Set(candidates));
      edge.calleeCandidates = uniq;
      if (uniq.length === 0) edge.confidence = "unresolved";
      else if (uniq.length === 1) edge.confidence = "unique";
      else edge.confidence = "multiple-candidates";
    }
  }
}

/** Compute the percentage of unresolved edges (0..100). */
export function computeUnresolvedPct(
  outgoingCallsByFile: Map<string, SymbolEdge[]>,
): number {
  let total = 0;
  let unresolved = 0;
  for (const edges of outgoingCallsByFile.values()) {
    for (const e of edges) {
      total++;
      if (e.confidence === "unresolved") unresolved++;
    }
  }
  return total === 0 ? 0 : (unresolved / total) * 100;
}
