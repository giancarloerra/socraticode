// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited
//
// Tests for QDRANT_COLLECTION_PREFIX (issue #49).
//
// QDRANT_COLLECTION_PREFIX is read once at module load in
// `src/constants.ts` and used by `src/config.ts` collection-name
// generators (and by `src/services/qdrant.ts` for the metadata
// collection). To exercise multiple prefix values in one test run we
// reset the module cache between cases and dynamically re-import the
// modules under test, which forces the env-var-reading IIFE in
// constants.ts to execute again.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ENV_KEY = "QDRANT_COLLECTION_PREFIX";

describe("QDRANT_COLLECTION_PREFIX", () => {
  const original = process.env[ENV_KEY];

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = original;
    }
    vi.resetModules();
  });

  describe("default (empty prefix) — backwards compatibility", () => {
    it("collectionName returns the legacy `codebase_<id>` form", async () => {
      delete process.env[ENV_KEY];
      const { collectionName } = await import("../../src/config.js");
      expect(collectionName("abc123def456")).toBe("codebase_abc123def456");
    });

    it("graphCollectionName returns the legacy `codegraph_<id>` form", async () => {
      delete process.env[ENV_KEY];
      const { graphCollectionName } = await import("../../src/config.js");
      expect(graphCollectionName("abc123def456")).toBe("codegraph_abc123def456");
    });

    it("contextCollectionName returns the legacy `context_<id>` form", async () => {
      delete process.env[ENV_KEY];
      const { contextCollectionName } = await import("../../src/config.js");
      expect(contextCollectionName("abc123def456")).toBe("context_abc123def456");
    });

    it("symgraphMetaCollectionName returns the legacy `<id>_symgraph_meta` form", async () => {
      delete process.env[ENV_KEY];
      const { symgraphMetaCollectionName } = await import("../../src/config.js");
      expect(symgraphMetaCollectionName("abc123def456")).toBe("abc123def456_symgraph_meta");
    });

    it("symgraphFileCollectionName returns the legacy `<id>_symgraph_file` form", async () => {
      delete process.env[ENV_KEY];
      const { symgraphFileCollectionName } = await import("../../src/config.js");
      expect(symgraphFileCollectionName("abc123def456")).toBe("abc123def456_symgraph_file");
    });

    it("symgraphIndexCollectionName returns the legacy `<id>_symgraph_index` form", async () => {
      delete process.env[ENV_KEY];
      const { symgraphIndexCollectionName } = await import("../../src/config.js");
      expect(symgraphIndexCollectionName("abc123def456")).toBe("abc123def456_symgraph_index");
    });

    it("treats empty-string env var the same as unset", async () => {
      process.env[ENV_KEY] = "";
      const { collectionName } = await import("../../src/config.js");
      expect(collectionName("abc")).toBe("codebase_abc");
    });
  });

  describe("non-empty prefix", () => {
    it("prepends the prefix to collectionName", async () => {
      process.env[ENV_KEY] = "myapp_";
      const { collectionName } = await import("../../src/config.js");
      expect(collectionName("abc123")).toBe("myapp_codebase_abc123");
    });

    it("prepends the prefix to graphCollectionName", async () => {
      process.env[ENV_KEY] = "myapp_";
      const { graphCollectionName } = await import("../../src/config.js");
      expect(graphCollectionName("abc123")).toBe("myapp_codegraph_abc123");
    });

    it("prepends the prefix to contextCollectionName", async () => {
      process.env[ENV_KEY] = "myapp_";
      const { contextCollectionName } = await import("../../src/config.js");
      expect(contextCollectionName("abc123")).toBe("myapp_context_abc123");
    });

    it("prepends the prefix to symgraph collection names (suffix-style still gets prefix)", async () => {
      process.env[ENV_KEY] = "myapp_";
      const {
        symgraphMetaCollectionName,
        symgraphFileCollectionName,
        symgraphIndexCollectionName,
      } = await import("../../src/config.js");
      expect(symgraphMetaCollectionName("abc")).toBe("myapp_abc_symgraph_meta");
      expect(symgraphFileCollectionName("abc")).toBe("myapp_abc_symgraph_file");
      expect(symgraphIndexCollectionName("abc")).toBe("myapp_abc_symgraph_index");
    });

    it("accepts prefixes without trailing separator (user choice)", async () => {
      process.env[ENV_KEY] = "myapp";
      const { collectionName } = await import("../../src/config.js");
      // The user may or may not include a separator; we prepend verbatim.
      expect(collectionName("abc")).toBe("myappcodebase_abc");
    });

    it("accepts prefixes with hyphen separator", async () => {
      process.env[ENV_KEY] = "team-alpha-";
      const { collectionName } = await import("../../src/config.js");
      expect(collectionName("abc")).toBe("team-alpha-codebase_abc");
    });

    it("two different prefixes produce disjoint collection-name sets for the same projectId", async () => {
      process.env[ENV_KEY] = "instance_a_";
      const { collectionName: collA } = await import("../../src/config.js");
      const nameA = collA("project1");

      vi.resetModules();
      process.env[ENV_KEY] = "instance_b_";
      const { collectionName: collB } = await import("../../src/config.js");
      const nameB = collB("project1");

      expect(nameA).toBe("instance_a_codebase_project1");
      expect(nameB).toBe("instance_b_codebase_project1");
      expect(nameA).not.toBe(nameB);
    });
  });

  describe("validation", () => {
    it("rejects a prefix containing whitespace", async () => {
      process.env[ENV_KEY] = "my app";
      await expect(import("../../src/constants.js")).rejects.toThrow(
        /Invalid QDRANT_COLLECTION_PREFIX/,
      );
    });

    it("rejects a prefix containing a slash", async () => {
      process.env[ENV_KEY] = "team/alpha";
      await expect(import("../../src/constants.js")).rejects.toThrow(
        /Invalid QDRANT_COLLECTION_PREFIX/,
      );
    });

    it("rejects a prefix containing a colon", async () => {
      process.env[ENV_KEY] = "team:alpha";
      await expect(import("../../src/constants.js")).rejects.toThrow(
        /Invalid QDRANT_COLLECTION_PREFIX/,
      );
    });

    it("rejects a prefix containing emoji or other unicode", async () => {
      process.env[ENV_KEY] = "rocket🚀";
      await expect(import("../../src/constants.js")).rejects.toThrow(
        /Invalid QDRANT_COLLECTION_PREFIX/,
      );
    });

    it("includes the offending value in the error message for discoverability", async () => {
      process.env[ENV_KEY] = "bad value";
      await expect(import("../../src/constants.js")).rejects.toThrow(/"bad value"/);
    });

    it("accepts a prefix containing only ASCII letters, digits, underscore, hyphen", async () => {
      process.env[ENV_KEY] = "a_B-9-z_";
      const constants = await import("../../src/constants.js");
      expect(constants.QDRANT_COLLECTION_PREFIX).toBe("a_B-9-z_");
    });
  });
});
