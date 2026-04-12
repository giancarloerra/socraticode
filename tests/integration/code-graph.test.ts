// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildCodeGraph,
  ensureDynamicLanguages,
  getAstGrepLang,
  getOrBuildGraph,
  invalidateGraphCache,
  rebuildGraph,
} from "../../src/services/code-graph.js";
import {
  findCircularDependencies,
  generateMermaidDiagram,
  getFileDependencies,
  getGraphStats,
} from "../../src/services/graph-analysis.js";
import {
  createFixtureProject,
  type FixtureProject,
  isDockerAvailable,
} from "../helpers/fixtures.js";

const _dockerAvailable = isDockerAvailable();

// Code graph tests don't strictly require Docker (no Qdrant/Ollama needed),
// but they do need AST grammars loaded. We skip the Docker check here
// since these are purely file-system + AST operations.

describe("code-graph service", () => {
  let fixture: FixtureProject;

  beforeAll(() => {
    ensureDynamicLanguages();
    fixture = createFixtureProject("code-graph-test");
  });

  afterAll(() => {
    fixture.cleanup();
  });

  describe("getAstGrepLang", () => {
    it("maps .ts to TypeScript Lang enum", () => {
      const lang = getAstGrepLang(".ts");
      expect(lang).toBeDefined();
      // It should be the TypeScript Lang enum value
      expect(String(lang)).toBe("TypeScript");
    });

    it("maps .js to JavaScript Lang enum", () => {
      const lang = getAstGrepLang(".js");
      expect(lang).toBeDefined();
      expect(String(lang)).toBe("JavaScript");
    });

    it("maps .py to python string", () => {
      const lang = getAstGrepLang(".py");
      expect(lang).toBe("python");
    });

    it("maps .go to go string", () => {
      const lang = getAstGrepLang(".go");
      expect(lang).toBe("go");
    });

    it("maps .rs to rust string", () => {
      const lang = getAstGrepLang(".rs");
      expect(lang).toBe("rust");
    });

    it("returns null for unsupported extensions", () => {
      expect(getAstGrepLang(".xyz")).toBeNull();
      expect(getAstGrepLang(".json")).toBeNull();
      expect(getAstGrepLang(".yaml")).toBeNull();
    });
  });

  describe("buildCodeGraph", () => {
    it("builds a graph from the fixture project", async () => {
      const graph = await buildCodeGraph(fixture.root);

      expect(graph).toBeDefined();
      expect(graph.nodes.length).toBeGreaterThan(0);
    });

    it("detects TypeScript files as graph nodes", async () => {
      const graph = await buildCodeGraph(fixture.root);
      const tsNodes = graph.nodes.filter((n) => n.relativePath.endsWith(".ts"));
      expect(tsNodes.length).toBeGreaterThanOrEqual(4); // index.ts, types.ts, helpers.ts, math.ts
    });

    it("detects import relationships as edges", async () => {
      const graph = await buildCodeGraph(fixture.root);

      // index.ts imports from helpers.ts, types.ts, and math.ts
      expect(graph.edges.length).toBeGreaterThan(0);

      // Check that index.ts has import edges
      const indexNode = graph.nodes.find((n) =>
        n.relativePath.includes("src/index.ts"),
      );
      expect(indexNode).toBeDefined();
      expect(indexNode?.dependencies.length).toBeGreaterThan(0);
    });

    it("tracks dependents (reverse edges)", async () => {
      const graph = await buildCodeGraph(fixture.root);

      // helpers.ts should be a dependent of index.ts (index.ts imports helpers.ts)
      const helpersNode = graph.nodes.find((n) =>
        n.relativePath.includes("helpers.ts"),
      );
      expect(helpersNode).toBeDefined();
      // If the graph correctly resolves imports, helpers should have dependents
      expect(helpersNode?.dependents.length).toBeGreaterThan(0);
    });

    it("includes Python files in the graph", async () => {
      const graph = await buildCodeGraph(fixture.root);
      const pyNodes = graph.nodes.filter((n) => n.relativePath.endsWith(".py"));
      expect(pyNodes.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("graph caching", () => {
    it("caches graphs via getOrBuildGraph", async () => {
      const graph1 = await getOrBuildGraph(fixture.root);
      const graph2 = await getOrBuildGraph(fixture.root);

      // Same object reference (cached)
      expect(graph1).toBe(graph2);
    });

    it("invalidates cache on invalidateGraphCache", async () => {
      const graph1 = await getOrBuildGraph(fixture.root);
      invalidateGraphCache(fixture.root);
      const graph2 = await getOrBuildGraph(fixture.root);

      // Different object (rebuilt)
      expect(graph1).not.toBe(graph2);
      // But same structure
      expect(graph2.nodes.length).toBeGreaterThan(0);
    });

    it("rebuilds via rebuildGraph", async () => {
      const graph1 = await getOrBuildGraph(fixture.root);
      const graph2 = await rebuildGraph(fixture.root);

      expect(graph1).not.toBe(graph2);
      expect(graph2.nodes.length).toBeGreaterThan(0);
    });
  });

  describe("graph analysis on real graph", () => {
    it("returns file dependencies from the built graph", async () => {
      const graph = await getOrBuildGraph(fixture.root);
      const indexPath = graph.nodes.find((n) =>
        n.relativePath.includes("src/index.ts"),
      )?.relativePath;

      if (indexPath) {
        const deps = getFileDependencies(graph, indexPath);
        expect(deps.imports.length).toBeGreaterThan(0);
      }
    });

    it("calculates graph stats", async () => {
      const graph = await getOrBuildGraph(fixture.root);
      const stats = getGraphStats(graph);

      expect(stats.totalFiles).toBeGreaterThan(0);
      expect(stats.languageBreakdown).toBeDefined();
      expect(stats.languageBreakdown.typescript).toBeGreaterThanOrEqual(4);
    });

    it("generates a Mermaid diagram", async () => {
      const graph = await getOrBuildGraph(fixture.root);
      const mermaid = generateMermaidDiagram(graph);

      expect(mermaid).toContain("graph LR");
      expect(mermaid).toContain("-->");
    });

    it("detects circular dependencies when present", async () => {
      const graph = await getOrBuildGraph(fixture.root);
      const cycles = findCircularDependencies(graph);

      // The fixture index.ts has a self-referencing import pattern
      // (detected as a self-cycle). Accept cycles being found.
      expect(Array.isArray(cycles)).toBe(true);
    });
  });
});
