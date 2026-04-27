// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CodeGraph } from "../../src/types.js";

// Mock the symbol-graph loader before importing the module under test —
// buildInteractiveGraphHtml calls into Qdrant via symbol-graph-store, which
// we don't want to hit from a pure unit test.
vi.mock("../../src/services/symbol-graph-store.js", () => ({
  loadSymbolGraphMeta: vi.fn().mockResolvedValue(null),
  loadFilePayload: vi.fn().mockResolvedValue(null),
}));

import { buildInteractiveGraphHtml, resetVisualizeAssetCache } from "../../src/services/graph-visualize-html.js";
import { loadFilePayload, loadSymbolGraphMeta } from "../../src/services/symbol-graph-store.js";

const SAMPLE_GRAPH: CodeGraph = {
  nodes: [
    { filePath: "/proj/a.ts", relativePath: "a.ts", imports: ["./b"], exports: [], dependencies: ["b.ts"], dependents: [] },
    { filePath: "/proj/b.ts", relativePath: "b.ts", imports: ["./c"], exports: [], dependencies: ["c.ts"], dependents: ["a.ts"] },
    { filePath: "/proj/c.ts", relativePath: "c.ts", imports: [], exports: [], dependencies: [], dependents: ["b.ts"] },
  ],
  edges: [
    { source: "a.ts", target: "b.ts", type: "import" },
    { source: "b.ts", target: "c.ts", type: "import" },
  ],
};

describe("graph-visualize-html", () => {
  beforeEach(() => {
    resetVisualizeAssetCache();
    vi.mocked(loadSymbolGraphMeta).mockResolvedValue(null);
    vi.mocked(loadFilePayload).mockResolvedValue(null);
  });

  it("builds a self-contained HTML page for a file-only graph", async () => {
    const { html, stats } = await buildInteractiveGraphHtml({
      projectPath: "/proj", projectName: "sample", projectId: "p1", graph: SAMPLE_GRAPH,
    });

    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("</html>");
    // Vendored Cytoscape + Dagre are inlined, not CDN references
    expect(html).not.toContain("cdn.jsdelivr.net");
    expect(html).not.toContain("unpkg.com");
    expect(html).toContain("Cytoscape");
    // Embedded data channel exists
    expect(html).toContain('id="socraticode-data"');
    // Project name appears in the header
    expect(html).toContain("sample");

    expect(stats.files).toBe(3);
    expect(stats.fileEdges).toBe(2);
    expect(stats.symbolMode).toBe("omitted");
  });

  it("escapes every '<' inside embedded JSON so a stray </script> cannot break out", async () => {
    const maliciousGraph: CodeGraph = {
      nodes: [{
        filePath: "/proj/weird.ts", relativePath: "weird</script><script>alert(1)</script>.ts",
        imports: [], exports: [], dependencies: [], dependents: [],
      }],
      edges: [],
    };
    const { html } = await buildInteractiveGraphHtml({
      projectPath: "/proj", projectName: "x", projectId: "p1", graph: maliciousGraph,
    });
    // Raw </script> must not appear inside the embedded-data <script> block.
    // Extract the JSON block and verify.
    const match = html.match(/<script id="socraticode-data"[^>]*>([\s\S]*?)<\/script>/);
    expect(match).toBeTruthy();
    const jsonText = match?.[1] ?? "";
    expect(jsonText.includes("</script>")).toBe(false);
    // The escape form we chose is \u003c (Unicode escape for '<').
    expect(jsonText).toContain("\\u003c");
  });

  it("omits the symbol graph when no meta is present and notes reason", async () => {
    vi.mocked(loadSymbolGraphMeta).mockResolvedValue(null);
    const { html, stats } = await buildInteractiveGraphHtml({
      projectPath: "/proj", projectName: "sample", projectId: "p1", graph: SAMPLE_GRAPH,
    });
    expect(stats.symbolMode).toBe("omitted");
    expect(stats.symbols).toBe(0);
    expect(stats.symbolEdges).toBe(0);
    // Data payload records the mode
    expect(html).toContain('"symbolMode":"omitted"');
  });

  it("flags symbolMode=capped when symbol counts exceed embed caps", async () => {
    vi.mocked(loadSymbolGraphMeta).mockResolvedValue({
      projectId: "p1",
      symbolCount: 999_999, edgeCount: 999_999, fileCount: 3,
      unresolvedEdgePct: 0, builtAt: Date.now(), schemaVersion: 1,
    });
    vi.mocked(loadFilePayload).mockResolvedValue({
      file: "a.ts", language: "typescript", contentHash: "x",
      symbols: [], outgoingCalls: [],
    });
    const { html, stats } = await buildInteractiveGraphHtml({
      projectPath: "/proj", projectName: "big", projectId: "p1", graph: SAMPLE_GRAPH,
    });
    expect(stats.symbolMode).toBe("capped");
    expect(html).toContain('"symbolMode":"capped"');
  });

  it("inlines vendored Cytoscape/Dagre bundles byte-for-byte (no $-token interpretation)", async () => {
    // Regression for a `String.prototype.replace(string, string)` pitfall: a `$&`
    // inside the replacement is interpreted as the match, corrupting any asset
    // (or embedded data) that contains `$&`, `$'`, `` $` ``, or `$$`.
    const { html } = await buildInteractiveGraphHtml({
      projectPath: "/proj", projectName: "bytes", projectId: "p1", graph: SAMPLE_GRAPH,
    });
    // If the bug returns, `\$&` becomes `\{{CYTOSCAPE}}` / `\{{DAGRE}}` in the output.
    expect(html.includes("\\{{CYTOSCAPE}}")).toBe(false);
    expect(html.includes("\\{{DAGRE}}")).toBe(false);
    // And the original token must survive verbatim from both bundles.
    expect(html.includes("\\$&")).toBe(true);
  });

  it("marks edges that belong to a cycle as cyclic:true", async () => {
    const cyclic: CodeGraph = {
      nodes: [
        { filePath: "/proj/x.ts", relativePath: "x.ts", imports: ["./y"], exports: [], dependencies: ["y.ts"], dependents: ["y.ts"] },
        { filePath: "/proj/y.ts", relativePath: "y.ts", imports: ["./x"], exports: [], dependencies: ["x.ts"], dependents: ["x.ts"] },
      ],
      edges: [
        { source: "x.ts", target: "y.ts", type: "import" },
        { source: "y.ts", target: "x.ts", type: "import" },
      ],
    };
    const { html } = await buildInteractiveGraphHtml({
      projectPath: "/proj", projectName: "cycle", projectId: "p1", graph: cyclic,
    });
    expect(html).toContain('"cyclic":true');
  });
});
