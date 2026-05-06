// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
    const savedLinkedEnv = process.env.SOCRATICODE_LINKED_PROJECTS;
    const savedProjectIdEnv = process.env.SOCRATICODE_PROJECT_ID;

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
      if (savedLinkedEnv === undefined) {
        delete process.env.SOCRATICODE_LINKED_PROJECTS;
      } else {
        process.env.SOCRATICODE_LINKED_PROJECTS = savedLinkedEnv;
      }
      if (savedProjectIdEnv === undefined) {
        delete process.env.SOCRATICODE_PROJECT_ID;
      } else {
        process.env.SOCRATICODE_PROJECT_ID = savedProjectIdEnv;
      }
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

    it("linked collections use base hash without branch suffix when SOCRATICODE_BRANCH_AWARE is true", () => {
      process.env.SOCRATICODE_BRANCH_AWARE = "true";
      fs.writeFileSync(
        path.join(projectDir, ".socraticode.json"),
        JSON.stringify({ linkedProjects: ["../linked-lib"] }),
      );

      // Get linked collection name with branch-aware on
      const withBranch = resolveLinkedCollections(projectDir);
      expect(withBranch).toHaveLength(2);
      const linkedNameWithBranch = withBranch[1].name;

      // Get linked collection name with branch-aware off
      delete process.env.SOCRATICODE_BRANCH_AWARE;
      const withoutBranch = resolveLinkedCollections(projectDir);
      const linkedNameWithoutBranch = withoutBranch[1].name;

      // Linked project collection name must be identical regardless of SOCRATICODE_BRANCH_AWARE
      expect(linkedNameWithBranch).toBe(linkedNameWithoutBranch);
      // And must NOT contain a branch suffix (double-underscore)
      expect(linkedNameWithBranch).not.toContain("__");
    });

    it("honors a linked project's committed projectId", () => {
      // Symmetry guarantee: the same project must resolve to the same
      // Qdrant collection whether it's the current root or a linked
      // dependency from another project. Without this, cross-project
      // search would silently miss the linked project's data when that
      // project pins its id via .socraticode.json.
      fs.writeFileSync(
        path.join(linkedDir, ".socraticode.json"),
        JSON.stringify({ projectId: "linked-stable" }),
      );
      fs.writeFileSync(
        path.join(projectDir, ".socraticode.json"),
        JSON.stringify({ linkedProjects: ["../linked-lib"] }),
      );

      const collections = resolveLinkedCollections(projectDir);
      expect(collections).toHaveLength(2);
      expect(collections[1].name).toBe("codebase_linked-stable");
    });

    it("dedups linked projects that share a committed projectId with the current project", () => {
      // Two physically distinct paths can declare the same shared
      // projectId — they point to the same Qdrant collection, so the
      // current project must not be queried twice (once as "self" and
      // once as "linked").
      fs.writeFileSync(
        path.join(linkedDir, ".socraticode.json"),
        JSON.stringify({ projectId: "shared-team-id" }),
      );
      fs.writeFileSync(
        path.join(projectDir, ".socraticode.json"),
        JSON.stringify({ projectId: "shared-team-id", linkedProjects: ["../linked-lib"] }),
      );

      const collections = resolveLinkedCollections(projectDir);
      expect(collections).toHaveLength(1);
      expect(collections[0].name).toBe("codebase_shared-team-id");
    });

    it("does not leak SOCRATICODE_PROJECT_ID env var into linked-project collection names", () => {
      // The env var is process-scoped and applies only to the current
      // project. Without this guard, linked projects would all collapse
      // onto the env-var collection name — wrong and silently lossy.
      process.env.SOCRATICODE_PROJECT_ID = "current-only";
      fs.writeFileSync(
        path.join(projectDir, ".socraticode.json"),
        JSON.stringify({ linkedProjects: ["../linked-lib"] }),
      );

      const collections = resolveLinkedCollections(projectDir);
      expect(collections).toHaveLength(2);
      expect(collections[0].name).toBe("codebase_current-only");
      expect(collections[1].name).toMatch(/^codebase_[0-9a-f]{12}$/);
      expect(collections[1].name).not.toBe("codebase_current-only");
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

    it("returns empty string when all characters are invalid", () => {
      expect(sanitizeBranchName("///")).toBe("");
      expect(sanitizeBranchName("@@@")).toBe("");
      expect(sanitizeBranchName("...")).toBe("");
    });
  });

  /** Create a temporary git repo with a named branch and initial commit. */
  function initTempRepo(tmpDir: string, branch: string): void {
    execFileSync("git", ["init", "-b", branch, tmpDir]);
    execFileSync("git", ["config", "user.name", "test"], { cwd: tmpDir });
    execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: tmpDir });
    execFileSync("git", ["commit", "--allow-empty", "-m", "init"], { cwd: tmpDir });
  }

  describe("detectGitBranch", () => {
    it("detects a branch in a git repo", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "socraticode-git-"));
      try {
        initTempRepo(tmpDir, "test-branch");
        const branch = detectGitBranch(tmpDir);
        expect(branch).toBe("test-branch");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
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
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "socraticode-braware-"));
      try {
        initTempRepo(tmpDir, "my-feature");
        process.env.SOCRATICODE_BRANCH_AWARE = "true";
        const id = projectIdFromPath(tmpDir);
        expect(id).toContain("__");
        const parts = id.split("__");
        expect(parts[0]).toMatch(/^[0-9a-f]{12}$/);
        expect(parts[1]).toBe("my-feature");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("produces valid Qdrant collection names with branch suffix", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "socraticode-braware-"));
      try {
        initTempRepo(tmpDir, "feat/some-branch");
        process.env.SOCRATICODE_BRANCH_AWARE = "true";
        const id = projectIdFromPath(tmpDir);
        const coll = collectionName(id);
        // Must be valid Qdrant name: [a-zA-Z0-9_-]+
        expect(coll).toMatch(/^[a-zA-Z0-9_-]+$/);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
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

  // ── projectId override via .socraticode.json ────────────────────────
  //
  // Allow teams to commit a stable `projectId` in `.socraticode.json` so
  // every machine that checks out the project addresses the same Qdrant
  // collection regardless of where the working tree lives on disk.

  describe("projectIdFromPath with .socraticode.json projectId", () => {
    let tmpDir: string;
    let projectDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "socraticode-projid-"));
      projectDir = path.join(tmpDir, "my-project");
      fs.mkdirSync(projectDir, { recursive: true });
      delete process.env.SOCRATICODE_PROJECT_ID;
      delete process.env.SOCRATICODE_BRANCH_AWARE;
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function writeConfig(config: unknown): void {
      fs.writeFileSync(path.join(projectDir, ".socraticode.json"), JSON.stringify(config));
    }

    it("uses projectId from .socraticode.json when env var is not set", () => {
      writeConfig({ projectId: "team-shared-ios" });
      expect(projectIdFromPath(projectDir)).toBe("team-shared-ios");
    });

    it("ignores path differences when file projectId is set", () => {
      // Two different projects on disk both pin to the same id — they should share collections.
      const otherDir = path.join(tmpDir, "another-project");
      fs.mkdirSync(otherDir, { recursive: true });
      writeConfig({ projectId: "shared-id" });
      fs.writeFileSync(
        path.join(otherDir, ".socraticode.json"),
        JSON.stringify({ projectId: "shared-id" }),
      );
      expect(projectIdFromPath(projectDir)).toBe(projectIdFromPath(otherDir));
    });

    it("trims whitespace from file projectId", () => {
      writeConfig({ projectId: "  trimmed-id  " });
      expect(projectIdFromPath(projectDir)).toBe("trimmed-id");
    });

    it("throws on invalid characters in file projectId", () => {
      writeConfig({ projectId: "invalid/name" });
      expect(() => projectIdFromPath(projectDir)).toThrow(
        /\.socraticode\.json.*projectId.*\[a-zA-Z0-9_-\]/,
      );
    });

    it("falls back to path hash when file projectId is empty string", () => {
      writeConfig({ projectId: "" });
      expect(projectIdFromPath(projectDir)).toMatch(/^[0-9a-f]{12}$/);
    });

    it("falls back to path hash when file projectId is whitespace only", () => {
      writeConfig({ projectId: "   " });
      expect(projectIdFromPath(projectDir)).toMatch(/^[0-9a-f]{12}$/);
    });

    it("falls back to path hash when file projectId has wrong type", () => {
      writeConfig({ projectId: 12345 });
      expect(projectIdFromPath(projectDir)).toMatch(/^[0-9a-f]{12}$/);
    });

    it("falls back to path hash when file projectId field is null", () => {
      writeConfig({ projectId: null });
      expect(projectIdFromPath(projectDir)).toMatch(/^[0-9a-f]{12}$/);
    });

    it("SOCRATICODE_PROJECT_ID env var takes precedence over file projectId", () => {
      writeConfig({ projectId: "from-file" });
      process.env.SOCRATICODE_PROJECT_ID = "from-env";
      expect(projectIdFromPath(projectDir)).toBe("from-env");
    });

    it("uses file projectId when .socraticode.json is absent → falls back to hash", () => {
      // No .socraticode.json written — current default behavior unchanged
      expect(projectIdFromPath(projectDir)).toMatch(/^[0-9a-f]{12}$/);
    });

    it("falls back to hash when .socraticode.json is malformed JSON", () => {
      fs.writeFileSync(path.join(projectDir, ".socraticode.json"), "not valid json{{{");
      expect(projectIdFromPath(projectDir)).toMatch(/^[0-9a-f]{12}$/);
    });

    it("does not append branch suffix when file projectId is set", () => {
      writeConfig({ projectId: "stable-id" });
      process.env.SOCRATICODE_BRANCH_AWARE = "true";
      // Initialize tmpDir as a git repo with a non-default branch to prove
      // that branch-aware mode is suppressed by an explicit projectId.
      // Disable gpg/ssh signing locally so the test is robust against the
      // user's global git config (commit.gpgsign=true is common).
      execFileSync("git", ["init", "-b", "feature-branch", projectDir]);
      execFileSync("git", ["config", "user.name", "test"], { cwd: projectDir });
      execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: projectDir });
      execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: projectDir });
      execFileSync("git", ["config", "tag.gpgsign", "false"], { cwd: projectDir });
      execFileSync("git", ["commit", "--allow-empty", "-m", "init"], { cwd: projectDir });

      const id = projectIdFromPath(projectDir);
      expect(id).toBe("stable-id");
      expect(id).not.toContain("__");
    });

    it("coexists with linkedProjects field in the same file", () => {
      // Regression guard: adding projectId must not break linkedProjects parsing.
      const linked = path.join(tmpDir, "linked");
      fs.mkdirSync(linked, { recursive: true });
      writeConfig({ projectId: "shared-id", linkedProjects: ["../linked"] });
      expect(projectIdFromPath(projectDir)).toBe("shared-id");
      // loadLinkedProjects is still happy — round-trip via resolveLinkedCollections
      const collections = resolveLinkedCollections(projectDir);
      expect(collections).toHaveLength(2);
      expect(collections[0].name).toBe("codebase_shared-id");
    });
  });
});
