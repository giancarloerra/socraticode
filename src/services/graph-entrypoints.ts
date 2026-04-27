// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited

/**
 * Entry-point detection — three-heuristic union:
 *   1. Graph orphans with outgoing calls (files that nothing imports but
 *      that call into other files)
 *   2. Conventional names (`main`, `Main`, `__main__`, etc.)
 *   3. Framework routes (Express/Flask/FastAPI/NestJS/Spring/ASP.NET/...)
 *
 * Each detected entry point carries a `reason` so the AI sees why.
 */

import { ENTRY_POINT_NAMES } from "../constants.js";
import type {
  CodeGraph,
  EntryPoint,
  SymbolGraphFilePayload,
  SymbolNode,
} from "../types.js";

/**
 * Detect entry points across all per-file payloads. The caller must supply
 * the file-import graph (for orphan detection) plus all per-file payloads.
 */
export function detectEntryPoints(
  fileGraph: CodeGraph,
  payloads: SymbolGraphFilePayload[],
): EntryPoint[] {
  const out: EntryPoint[] = [];
  const seen = new Set<string>();
  const push = (e: EntryPoint): void => {
    const key = `${e.id}::${e.reason}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(e);
  };

  // Heuristic 1: orphans with outgoing calls
  const payloadByFile = new Map(payloads.map((p) => [p.file, p]));
  for (const node of fileGraph.nodes) {
    if (node.dependents.length > 0) continue;
    const payload = payloadByFile.get(node.relativePath);
    if (!payload || payload.outgoingCalls.length === 0) continue;
    push({
      id: node.relativePath,
      name: node.relativePath,
      file: node.relativePath,
      reason: "orphan",
    });
  }

  // Heuristic 2: conventional names
  for (const p of payloads) {
    const conventional = ENTRY_POINT_NAMES[p.language];
    if (!conventional) continue;
    for (const sym of p.symbols) {
      if (conventional.has(sym.name) && sym.name !== "<module>") {
        push({
          id: sym.id,
          name: sym.qualifiedName,
          file: sym.file,
          line: sym.line,
          reason: `well-known-name:${sym.name}`,
        });
      }
    }
  }

  // Heuristic 3: framework routes (regex over source not always available
  // at this stage — instead inspect symbol decorators recorded as siblings,
  // or fall back to outgoing call patterns naming framework router methods).
  for (const p of payloads) {
    for (const reason of detectFrameworkReasons(p)) {
      push({
        id: reason.symbol.id,
        name: reason.symbol.qualifiedName,
        file: reason.symbol.file,
        line: reason.symbol.line,
        reason: reason.reason,
      });
    }
  }

  return out;
}

/** Per-file framework heuristics based on call sites + symbol names. */
function detectFrameworkReasons(
  p: SymbolGraphFilePayload,
): Array<{ symbol: SymbolNode; reason: string }> {
  const out: Array<{ symbol: SymbolNode; reason: string }> = [];

  // Build a lookup from line → enclosing symbol
  const symbolsByStartLine = [...p.symbols].sort((a, b) => a.line - b.line);
  const findSymbolAt = (line: number): SymbolNode | null => {
    let best: SymbolNode | null = null;
    for (const s of symbolsByStartLine) {
      if (s.line <= line && line <= s.endLine && s.name !== "<module>") {
        if (!best || s.line >= best.line) best = s;
      }
    }
    return best;
  };

  // Inspect outgoingCalls for framework router method calls
  // (e.g. `app.get`, `router.post`, `Route::get`, `app.route`)
  const framework = (calleeName: string): string | null => {
    const lower = calleeName.toLowerCase();
    if (["get", "post", "put", "delete", "patch", "head", "options", "all", "use"].includes(lower)) {
      return `framework:http-${lower}`;
    }
    if (lower === "route") return "framework:route";
    return null;
  };

  for (const e of p.outgoingCalls) {
    const reason = framework(e.calleeName);
    if (!reason) continue;
    const enclosing = findSymbolAt(e.callSite.line);
    if (!enclosing) continue;
    out.push({ symbol: enclosing, reason });
  }

  // Test functions: names starting with `test_`, `Test`, or matching `it`/`describe`
  for (const s of p.symbols) {
    if (s.name === "<module>") continue;
    if (
      /^test[_A-Z]/.test(s.name) ||
      /^Test[A-Z_]/.test(s.name) ||
      s.name === "it" ||
      s.name === "describe"
    ) {
      out.push({ symbol: s, reason: "test" });
    }
  }

  return out;
}
