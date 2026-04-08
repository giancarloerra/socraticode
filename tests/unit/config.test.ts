// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { collectionName, contextCollectionName, detectGitBranch, graphCollectionName, loadLinkedProjects, projectIdFromPath, resolveLinkedCollections, sanitizeBranchName } from "../../src/config.js";

describe("config", () => {
  // Clean up env overrides between tests
  const originalEnv = process.env.SOCRATICODE_PROJECT_ID;
  const originalBranchAware = process.env.SOCRATICODE_BRANCH_AWARE;
  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.SOCRATICODE_PROJECT_ID;
    } else {
      process.env.SOCRATICODE_PROJECT_ID = originalEnv;
    }
    if (originalBranchAware === undefined) {
      delete process.env.SOCRATICODE_BRANCH_AWARE;
    } else {
      process.env.SOCRATICODE_BRANCH_AWARE = originalBranchAware;
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

  // ── Linked projects ─────────────────────────────────────────────────

  describe("loadLinkedProjects", () => {
    let tmpDir: string;
    let projectDir: string;
    let linkedDirA: string;
    let linkedDirB: string;
    const originalLinkedEnv = process.env.SOCRATICODE_LINKED_PROJECTS;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "socraticode-test-"));
      projectDir = path.join(tmpDir, "my-project");
      linkedDirA = path.join(tmpDir, "linked-a");
      linkedDirB = path.join(tmpDir, "linked-b");
      fs.mkdirSync(projectDir, { recursive: true });
      fs.mkdirSync(linkedDirA, { recursive: true });
      fs.mkdirSync(linkedDirB, { recursive: true });
      delete process.env.SOCRATICODE_LINKED_PROJECTS;
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      if (originalLinkedEnv === undefined) {
        delete process.env.SOCRATICODE_LINKED_PROJECTS;
      } else {
        process.env.SOCRATICODE_LINKED_PROJECTS = originalLinkedEnv;
      }
    });

    it("returns empty array when no .socraticode.json exists", () => {
      expect(loadLinkedProjects(projectDir)).toEqual([]);
    });

    it("reads linked projects from .socraticode.json", () => {
      fs.writeFileSync(
        path.join(projectDir, ".socraticode.json"),
        JSON.stringify({ linkedProjects: ["../linked-a", "../linked-b"] }),
      );
      const result = loadLinkedProjects(projectDir);
      expect(result).toHaveLength(2);
      expect(result).toContain(linkedDirA);
      expect(result).toContain(linkedDirB);
    });

    it("skips non-existent linked paths", () => {
      fs.writeFileSync(
        path.join(projectDir, ".socraticode.json"),
        JSON.stringify({ linkedProjects: ["../linked-a", "../does-not-exist"] }),
      );
      const result = loadLinkedProjects(projectDir);
      expect(result).toHaveLength(1);
      expect(result).toContain(linkedDirA);
    });

    it("skips self-references", () => {
      fs.writeFileSync(
        path.join(projectDir, ".socraticode.json"),
        JSON.stringify({ linkedProjects: [".", "../my-project"] }),
      );
      expect(loadLinkedProjects(projectDir)).toEqual([]);
    });

    it("reads from SOCRATICODE_LINKED_PROJECTS env var", () => {
      process.env.SOCRATICODE_LINKED_PROJECTS = `${linkedDirA},${linkedDirB}`;
      const result = loadLinkedProjects(projectDir);
      expect(result).toHaveLength(2);
      expect(result).toContain(linkedDirA);
      expect(result).toContain(linkedDirB);
    });

    it("merges config file and env var without duplicates", () => {
      fs.writeFileSync(
        path.join(projectDir, ".socraticode.json"),
        JSON.stringify({ linkedProjects: ["../linked-a"] }),
      );
      process.env.SOCRATICODE_LINKED_PROJECTS = `${linkedDirA},${linkedDirB}`;
      const result = loadLinkedProjects(projectDir);
      // linked-a appears in both sources but should be deduplicated
      expect(result).toHaveLength(2);
      expect(result).toContain(linkedDirA);
      expect(result).toContain(linkedDirB);
    });

    it("handles malformed .socraticode.json gracefully", () => {
      fs.writeFileSync(path.join(projectDir, ".socraticode.json"), "not valid json{{{");
      expect(loadLinkedProjects(projectDir)).toEqual([]);
    });

    it("handles .socraticode.json with missing linkedProjects field", () => {
      fs.writeFileSync(
        path.join(projectDir, ".socraticode.json"),
        JSON.stringify({ someOtherField: true }),
      );
      expect(loadLinkedProjects(projectDir)).toEqual([]);
    });
  });

  describe("resolveLinkedCollections", () => {
    let tmpDir: string;
    let projectDir: string;
    let linkedDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "socraticode-test-"));
      projectDir = path.join(tmpDir, "main-project");
      linkedDir = path.join(tmpDir, "linked-lib");
      fs.mkdirSync(projectDir, { recursive: true });
      fs.mkdirSync(linkedDir, { recursive: true });
      delete process.env.SOCRATICODE_LINKED_PROJECTS;
      delete process.env.SOCRATICODE_PROJECT_ID;
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      delete process.env.SOCRATICODE_LINKED_PROJECTS;
    });

    it("returns only current project when no links configured", () => {
      const collections = resolveLinkedCollections(projectDir);
      expect(collections).toHaveLength(1);
      expect(collections[0].label).toBe("main-project");
      expect(collections[0].name).toMatch(/^codebase_/);
    });

    it("returns current + linked collections with correct labels", () => {
      fs.writeFileSync(
        path.join(projectDir, ".socraticode.json"),
        JSON.stringify({ linkedProjects: ["../linked-lib"] }),
      );
      const collections = resolveLinkedCollections(projectDir);
      expect(collections).toHaveLength(2);
      // Current project is first (highest priority)
      expect(collections[0].label).toBe("main-project");
      expect(collections[1].label).toBe("linked-lib");
      // Different collection names
      expect(collections[0].name).not.toBe(collections[1].name);
    });
  });

  // ── Branch awareness ────────────────────────────────────────────────

  describe("sanitizeBranchName", () => {
    it("passes through simple branch names", () => {
      expect(sanitizeBranchName("main")).toBe("main");
      expect(sanitizeBranchName("develop")).toBe("develop");
    });

    it("replaces slashes with underscores", () => {
      expect(sanitizeBranchName("feat/my-feature")).toBe("feat_my-feature");
    });

    it("handles deeply nested branch names", () => {
      expect(sanitizeBranchName("feature/JIRA-123/some-work")).toBe(
        "feature_JIRA-123_some-work",
      );
    });

    it("collapses consecutive underscores", () => {
      expect(sanitizeBranchName("feat//double")).toBe("feat_double");
    });

    it("strips leading and trailing underscores", () => {
      expect(sanitizeBranchName("/leading")).toBe("leading");
      expect(sanitizeBranchName("trailing/")).toBe("trailing");
    });

    it("preserves hyphens", () => {
      expect(sanitizeBranchName("my-branch-name")).toBe("my-branch-name");
    });

    it("replaces special characters", () => {
      expect(sanitizeBranchName("feat@v2.0")).toBe("feat_v2_0");
    });
  });

  describe("detectGitBranch", () => {
    it("detects a branch in the current repo", () => {
      // This test runs inside the socraticode git repo
      const branch = detectGitBranch(process.cwd());
      expect(branch).toBeTruthy();
      expect(typeof branch).toBe("string");
    });

    it("returns null for non-git directories", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "socraticode-nogit-"));
      try {
        expect(detectGitBranch(tmpDir)).toBeNull();
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("projectIdFromPath with SOCRATICODE_BRANCH_AWARE", () => {
    it("does not include branch suffix by default", () => {
      const id = projectIdFromPath("/some/project/path");
      expect(id).toMatch(/^[0-9a-f]{12}$/);
      expect(id).not.toContain("__");
    });

    it("appends branch suffix when SOCRATICODE_BRANCH_AWARE=true", () => {
      process.env.SOCRATICODE_BRANCH_AWARE = "true";
      // Run from current repo directory so git detection works
      const id = projectIdFromPath(process.cwd());
      expect(id).toContain("__");
      // Hash part + __ + branch
      const parts = id.split("__");
      expect(parts[0]).toMatch(/^[0-9a-f]{12}$/);
      expect(parts[1]).toBeTruthy();
    });

    it("produces valid Qdrant collection names with branch suffix", () => {
      process.env.SOCRATICODE_BRANCH_AWARE = "true";
      const id = projectIdFromPath(process.cwd());
      const coll = collectionName(id);
      // Must be valid Qdrant name: [a-zA-Z0-9_-]+
      expect(coll).toMatch(/^[a-zA-Z0-9_-]+$/);
    });

    it("does not append branch when SOCRATICODE_PROJECT_ID is set", () => {
      process.env.SOCRATICODE_BRANCH_AWARE = "true";
      process.env.SOCRATICODE_PROJECT_ID = "explicit-id";
      const id = projectIdFromPath(process.cwd());
      expect(id).toBe("explicit-id");
      expect(id).not.toContain("__");
    });

    it("does not append branch when SOCRATICODE_BRANCH_AWARE is not true", () => {
      process.env.SOCRATICODE_BRANCH_AWARE = "false";
      const id = projectIdFromPath(process.cwd());
      expect(id).toMatch(/^[0-9a-f]{12}$/);
    });
  });
});
