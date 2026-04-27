// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited

import { describe, expect, it } from "vitest";
import { detectEntryPoints } from "../../src/services/graph-entrypoints.js";
import type { CodeGraph, SymbolGraphFilePayload } from "../../src/types.js";

function mkPayload(file: string, syms: { name: string; line?: number }[]): SymbolGraphFilePayload {
  return {
    file,
    language: "typescript",
    contentHash: "abc",
    symbols: [
      {
        id: `${file}::<module>#1`,
        name: "<module>",
        qualifiedName: "<module>",
        kind: "module",
        file,
        line: 1,
        endLine: 100,
        language: "typescript",
      },
      ...syms.map((s) => ({
        id: `${file}::${s.name}#${s.line ?? 1}`,
        name: s.name,
        qualifiedName: s.name,
        kind: "function" as const,
        file,
        line: s.line ?? 1,
        endLine: (s.line ?? 1) + 5,
        language: "typescript",
      })),
    ],
    outgoingCalls: [],
  };
}

describe("graph-entrypoints", () => {
  it("detects orphan files (no dependents) with outgoing calls", () => {
    const graph: CodeGraph = {
      nodes: [
        {
          relativePath: "src/main.ts",
          imports: [],
          exports: [],
          dependencies: ["src/lib.ts"],
          dependents: [], // orphan
        },
        {
          relativePath: "src/lib.ts",
          imports: [],
          exports: [],
          dependencies: [],
          dependents: ["src/main.ts"],
        },
      ],
      edges: [],
    };
    const payloads: SymbolGraphFilePayload[] = [
      {
        ...mkPayload("src/main.ts", [{ name: "run", line: 5 }]),
        outgoingCalls: [
          {
            callerId: "src/main.ts::run#5",
            calleeName: "lib",
            calleeCandidates: ["src/lib.ts::lib#1"],
            confidence: "unique",
            callSite: { file: "src/main.ts", line: 6 },
          },
        ],
      },
      mkPayload("src/lib.ts", [{ name: "lib", line: 1 }]),
    ];
    const entries = detectEntryPoints(graph, payloads);
    expect(entries.some((e) => e.reason === "orphan")).toBe(true);
  });

  it("detects conventional entry-point names like main()", () => {
    const graph: CodeGraph = {
      nodes: [
        {
          relativePath: "cmd/server.go",
          imports: [],
          exports: [],
          dependencies: ["pkg/util.go"],
          dependents: ["pkg/util.go"], // not an orphan
        },
      ],
      edges: [],
    };
    const payloads: SymbolGraphFilePayload[] = [
      mkPayload("cmd/server.go", [{ name: "main", line: 10 }]),
    ];
    const entries = detectEntryPoints(graph, payloads);
    expect(entries.some((e) => e.name === "main")).toBe(true);
  });

  it("returns empty array when nothing matches", () => {
    const graph: CodeGraph = { nodes: [], edges: [] };
    const entries = detectEntryPoints(graph, []);
    expect(entries).toEqual([]);
  });
});
