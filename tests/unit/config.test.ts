// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited
import { afterEach, describe, expect, it } from "vitest";
import { collectionName, contextCollectionName, graphCollectionName, projectIdFromPath } from "../../src/config.js";

describe("config", () => {
  // Clean up env override between tests
  const originalEnv = process.env.SOCRATICODE_PROJECT_ID;
  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.SOCRATICODE_PROJECT_ID;
    } else {
      process.env.SOCRATICODE_PROJECT_ID = originalEnv;
    }
  });

  describe("projectIdFromPath", () => {
    it("returns a 12-character hex string", () => {
      const id = projectIdFromPath("/some/project/path");
      expect(id).toMatch(/^[0-9a-f]{12}$/);
    });

    it("returns the same ID for the same path", () => {
      const id1 = projectIdFromPath("/some/project/path");
      const id2 = projectIdFromPath("/some/project/path");
      expect(id1).toBe(id2);
    });

    it("returns different IDs for different paths", () => {
      const id1 = projectIdFromPath("/project/alpha");
      const id2 = projectIdFromPath("/project/beta");
      expect(id1).not.toBe(id2);
    });

    it("normalizes paths (resolves relative components)", () => {
      const id1 = projectIdFromPath("/some/project/./path");
      const id2 = projectIdFromPath("/some/project/path");
      expect(id1).toBe(id2);
    });

    it("normalizes paths with parent directory references", () => {
      const id1 = projectIdFromPath("/some/project/sub/../path");
      const id2 = projectIdFromPath("/some/project/path");
      expect(id1).toBe(id2);
    });

    it("handles paths with trailing slashes consistently", () => {
      // path.resolve strips trailing slashes, so these should differ
      // (or be the same depending on OS behavior)
      const id1 = projectIdFromPath("/some/project");
      const id2 = projectIdFromPath("/some/project/");
      // path.resolve normalizes trailing slash, so they should match
      expect(id1).toBe(id2);
    });

    it("uses SOCRATICODE_PROJECT_ID when set", () => {
      process.env.SOCRATICODE_PROJECT_ID = "my-shared-project";
      const id = projectIdFromPath("/some/project/path");
      expect(id).toBe("my-shared-project");
    });

    it("ignores path differences when SOCRATICODE_PROJECT_ID is set", () => {
      process.env.SOCRATICODE_PROJECT_ID = "shared";
      const id1 = projectIdFromPath("/worktree/a");
      const id2 = projectIdFromPath("/worktree/b");
      expect(id1).toBe(id2);
    });

    it("trims whitespace from SOCRATICODE_PROJECT_ID", () => {
      process.env.SOCRATICODE_PROJECT_ID = "  my-project  ";
      expect(projectIdFromPath("/any/path")).toBe("my-project");
    });

    it("throws on invalid SOCRATICODE_PROJECT_ID characters", () => {
      process.env.SOCRATICODE_PROJECT_ID = "invalid/name";
      expect(() => projectIdFromPath("/any/path")).toThrow(
        /SOCRATICODE_PROJECT_ID must match/,
      );
    });

    it("falls back to hash when SOCRATICODE_PROJECT_ID is empty", () => {
      process.env.SOCRATICODE_PROJECT_ID = "  ";
      const id = projectIdFromPath("/some/project/path");
      expect(id).toMatch(/^[0-9a-f]{12}$/);
    });
  });

  describe("collectionName", () => {
    it("prefixes with codebase_", () => {
      expect(collectionName("abc123def456")).toBe("codebase_abc123def456");
    });

    it("handles empty string", () => {
      expect(collectionName("")).toBe("codebase_");
    });
  });

  describe("graphCollectionName", () => {
    it("prefixes with codegraph_", () => {
      expect(graphCollectionName("abc123def456")).toBe("codegraph_abc123def456");
    });

    it("handles empty string", () => {
      expect(graphCollectionName("")).toBe("codegraph_");
    });
  });

  describe("contextCollectionName", () => {
    it("prefixes with context_", () => {
      expect(contextCollectionName("abc123def456")).toBe("context_abc123def456");
    });

    it("handles empty string", () => {
      expect(contextCollectionName("")).toBe("context_");
    });
  });

  describe("round-trip: path → projectId → collection names", () => {
    it("produces valid Qdrant-friendly collection names", () => {
      const projectId = projectIdFromPath("/Users/test/my-project");
      const coll = collectionName(projectId);
      const graphColl = graphCollectionName(projectId);

      // Qdrant collection names must match: ^[a-zA-Z0-9_-]+$
      expect(coll).toMatch(/^[a-zA-Z0-9_-]+$/);
      expect(graphColl).toMatch(/^[a-zA-Z0-9_-]+$/);
      expect(coll).toMatch(/^codebase_[0-9a-f]{12}$/);
      expect(graphColl).toMatch(/^codegraph_[0-9a-f]{12}$/);
    });

    it("produces a valid context collection name", () => {
      const projectId = projectIdFromPath("/Users/test/my-project");
      const contextColl = contextCollectionName(projectId);
      expect(contextColl).toMatch(/^[a-zA-Z0-9_-]+$/);
      expect(contextColl).toMatch(/^context_[0-9a-f]{12}$/);
    });
  });
});
