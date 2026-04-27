// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited

import { describe, expect, it } from "vitest";
import {
  computeUnresolvedPct,
  resolveCallSites,
} from "../../src/services/graph-symbol-resolution.js";
import type { CodeGraph, SymbolEdge, SymbolNode } from "../../src/types.js";

function mkGraph(): CodeGraph {
  return {
    nodes: [
      {
        relativePath: "src/a.ts",
        imports: [],
        exports: [],
        dependencies: ["src/b.ts"],
        dependents: [],
      },
      {
        relativePath: "src/b.ts",
        imports: [],
        exports: [],
        dependencies: ["src/c.ts"],
        dependents: ["src/a.ts"],
      },
      {
        relativePath: "src/c.ts",
        imports: [],
        exports: [],
        dependencies: [],
        dependents: ["src/b.ts"],
      },
    ],
    edges: [],
  };
}

describe("graph-symbol-resolution", () => {
  it("resolves a local call to unique confidence", () => {
    const graph = mkGraph();
    const symbolsByFile = new Map<string, SymbolNode[]>([
      [
        "src/a.ts",
        [
          { id: "src/a.ts::foo#1", name: "foo", qualifiedName: "foo", kind: "function", file: "src/a.ts", line: 1, endLine: 3, language: "typescript" },
          { id: "src/a.ts::caller#5", name: "caller", qualifiedName: "caller", kind: "function", file: "src/a.ts", line: 5, endLine: 8, language: "typescript" },
        ],
      ],
    ]);
    const edges: SymbolEdge[] = [
      {
        callerId: "src/a.ts::caller#5",
        calleeName: "foo",
        calleeCandidates: [],
        confidence: "unresolved",
        callSite: { file: "src/a.ts", line: 6 },
      },
    ];
    const outgoing = new Map<string, SymbolEdge[]>([["src/a.ts", edges]]);
    resolveCallSites(graph, symbolsByFile, outgoing);
    expect(edges[0].confidence).toBe("local");
    expect(edges[0].calleeCandidates).toContain("src/a.ts::foo#1");
  });

  it("resolves an imported call by walking dependencies", () => {
    const graph = mkGraph();
    const symbolsByFile = new Map<string, SymbolNode[]>([
      [
        "src/a.ts",
        [{ id: "src/a.ts::caller#1", name: "caller", qualifiedName: "caller", kind: "function", file: "src/a.ts", line: 1, endLine: 3, language: "typescript" }],
      ],
      [
        "src/b.ts",
        [{ id: "src/b.ts::helper#1", name: "helper", qualifiedName: "helper", kind: "function", file: "src/b.ts", line: 1, endLine: 5, language: "typescript" }],
      ],
    ]);
    const edges: SymbolEdge[] = [
      {
        callerId: "src/a.ts::caller#1",
        calleeName: "helper",
        calleeCandidates: [],
        confidence: "unresolved",
        callSite: { file: "src/a.ts", line: 2 },
      },
    ];
    const outgoing = new Map<string, SymbolEdge[]>([["src/a.ts", edges]]);
    resolveCallSites(graph, symbolsByFile, outgoing);
    expect(["unique", "multiple-candidates"]).toContain(edges[0].confidence);
    expect(edges[0].calleeCandidates).toContain("src/b.ts::helper#1");
  });

  it("leaves a call unresolved when no symbol matches anywhere", () => {
    const graph = mkGraph();
    const symbolsByFile = new Map<string, SymbolNode[]>();
    const edges: SymbolEdge[] = [
      {
        callerId: "src/a.ts::<module>#1",
        calleeName: "doesNotExist",
        calleeCandidates: [],
        confidence: "unresolved",
        callSite: { file: "src/a.ts", line: 1 },
      },
    ];
    const outgoing = new Map<string, SymbolEdge[]>([["src/a.ts", edges]]);
    resolveCallSites(graph, symbolsByFile, outgoing);
    expect(edges[0].confidence).toBe("unresolved");
    expect(edges[0].calleeCandidates).toEqual([]);
  });

  it("computeUnresolvedPct returns 0 when no edges", () => {
    expect(computeUnresolvedPct(new Map())).toBe(0);
  });

  it("computeUnresolvedPct reports correct percentage", () => {
    const map = new Map<string, SymbolEdge[]>([
      [
        "src/a.ts",
        [
          { callerId: "x", calleeName: "y", calleeCandidates: ["x"], confidence: "unique", callSite: { file: "x", line: 1 } },
          { callerId: "x", calleeName: "z", calleeCandidates: [], confidence: "unresolved", callSite: { file: "x", line: 2 } },
        ],
      ],
    ]);
    expect(computeUnresolvedPct(map)).toBe(50);
  });
});
