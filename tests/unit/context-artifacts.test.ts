// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited

import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contextCollectionName } from "../../src/config.js";
import {
  chunkArtifactContent,
  loadConfig,
  readArtifactContent,
} from "../../src/services/context-artifacts.js";

// ── Temp directory helpers ────────────────────────────────────────────────

let tempDir: string;

beforeAll(async () => {
  tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "socraticode-context-test-"));
});

afterAll(async () => {
  await fsp.rm(tempDir, { recursive: true, force: true });
});

async function createTempProject(
  files: Record<string, string>,
): Promise<string> {
  const projectDir = path.join(tempDir, `proj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await fsp.mkdir(projectDir, { recursive: true });
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(projectDir, filePath);
    await fsp.mkdir(path.dirname(fullPath), { recursive: true });
    await fsp.writeFile(fullPath, content);
  }
  return projectDir;
}

// ── loadConfig ─────────────────────────────────────────────────────────

describe("loadConfig", () => {
  it("returns null when no .socraticodecontextartifacts.json exists", async () => {
    const projectDir = await createTempProject({ "README.md": "# Hello" });
    // Point global fallback to a non-existent directory so we only test project-level
    const originalEnv = process.env.SOCRATICODE_GLOBAL_CONFIG_DIR;
    process.env.SOCRATICODE_GLOBAL_CONFIG_DIR = path.join(tempDir, "nonexistent-global");
    try {
      const config = await loadConfig(projectDir);
      expect(config).toBeNull();
    } finally {
      if (originalEnv === undefined) {
        delete process.env.SOCRATICODE_GLOBAL_CONFIG_DIR;
      } else {
        process.env.SOCRATICODE_GLOBAL_CONFIG_DIR = originalEnv;
      }
    }
  });

  it("parses a valid .socraticodecontextartifacts.json", async () => {
    const projectDir = await createTempProject({
      ".socraticodecontextartifacts.json": JSON.stringify({
        artifacts: [
          {
            name: "db-schema",
            path: "./schema.sql",
            description: "Database schema",
          },
        ],
      }),
    });
    const config = await loadConfig(projectDir);
    expect(config).not.toBeNull();
    expect(config?.artifacts).toHaveLength(1);
    expect(config?.artifacts?.[0].name).toBe("db-schema");
    expect(config?.artifacts?.[0].path).toBe("./schema.sql");
    expect(config?.artifacts?.[0].description).toBe("Database schema");
  });

  it("accepts config without artifacts key", async () => {
    const projectDir = await createTempProject({
      ".socraticodecontextartifacts.json": JSON.stringify({}),
    });
    const config = await loadConfig(projectDir);
    expect(config).not.toBeNull();
    expect(config?.artifacts).toBeUndefined();
  });

  it("accepts multiple artifacts", async () => {
    const projectDir = await createTempProject({
      ".socraticodecontextartifacts.json": JSON.stringify({
        artifacts: [
          { name: "schema", path: "./schema.sql", description: "DB schema" },
          { name: "api", path: "./api.yaml", description: "API spec" },
          { name: "infra", path: "./terraform/", description: "Infra configs" },
        ],
      }),
    });
    const config = await loadConfig(projectDir);
    expect(config?.artifacts).toHaveLength(3);
  });

  it("throws on invalid JSON", async () => {
    const projectDir = await createTempProject({
      ".socraticodecontextartifacts.json": "{ not valid json }",
    });
    await expect(loadConfig(projectDir)).rejects.toThrow("not valid JSON");
  });

  it("throws when root is not an object", async () => {
    const projectDir = await createTempProject({
      ".socraticodecontextartifacts.json": JSON.stringify([1, 2, 3]),
    });
    await expect(loadConfig(projectDir)).rejects.toThrow("must be a JSON object");
  });

  it("throws when artifacts is not an array", async () => {
    const projectDir = await createTempProject({
      ".socraticodecontextartifacts.json": JSON.stringify({ artifacts: "not-an-array" }),
    });
    await expect(loadConfig(projectDir)).rejects.toThrow('"artifacts" must be an array');
  });

  it("throws when artifact is missing name", async () => {
    const projectDir = await createTempProject({
      ".socraticodecontextartifacts.json": JSON.stringify({
        artifacts: [{ path: "./schema.sql", description: "DB" }],
      }),
    });
    await expect(loadConfig(projectDir)).rejects.toThrow("name must be a non-empty string");
  });

  it("throws when artifact has empty name", async () => {
    const projectDir = await createTempProject({
      ".socraticodecontextartifacts.json": JSON.stringify({
        artifacts: [{ name: "  ", path: "./schema.sql", description: "DB" }],
      }),
    });
    await expect(loadConfig(projectDir)).rejects.toThrow("name must be a non-empty string");
  });

  it("throws when artifact is missing path", async () => {
    const projectDir = await createTempProject({
      ".socraticodecontextartifacts.json": JSON.stringify({
        artifacts: [{ name: "schema", description: "DB" }],
      }),
    });
    await expect(loadConfig(projectDir)).rejects.toThrow("path must be a non-empty string");
  });

  it("throws when artifact is missing description", async () => {
    const projectDir = await createTempProject({
      ".socraticodecontextartifacts.json": JSON.stringify({
        artifacts: [{ name: "schema", path: "./schema.sql" }],
      }),
    });
    await expect(loadConfig(projectDir)).rejects.toThrow("description must be a non-empty string");
  });

  it("falls back to global config when project-level config is absent", async () => {
    const projectDir = await createTempProject({ "README.md": "# Hello" });
    // Create a global config directory with a config file
    const globalDir = path.join(tempDir, `global-${Date.now()}`);
    await fsp.mkdir(globalDir, { recursive: true });
    await fsp.writeFile(
      path.join(globalDir, ".socraticodecontextartifacts.json"),
      JSON.stringify({
        artifacts: [
          { name: "shared-schema", path: "./shared/schema.sql", description: "Shared DB schema" },
        ],
      }),
    );

    // Override the env var to point to our temp global dir
    const originalEnv = process.env.SOCRATICODE_GLOBAL_CONFIG_DIR;
    process.env.SOCRATICODE_GLOBAL_CONFIG_DIR = globalDir;
    try {
      const config = await loadConfig(projectDir);
      expect(config).not.toBeNull();
      expect(config?.artifacts).toHaveLength(1);
      expect(config?.artifacts?.[0].name).toBe("shared-schema");
    } finally {
      if (originalEnv === undefined) {
        delete process.env.SOCRATICODE_GLOBAL_CONFIG_DIR;
      } else {
        process.env.SOCRATICODE_GLOBAL_CONFIG_DIR = originalEnv;
      }
    }
  });

  it("resolves relative artifact paths against global config dir when using fallback", async () => {
    const projectDir = await createTempProject({ "README.md": "# Hello" });
    const globalDir = path.join(tempDir, `global-resolve-${Date.now()}`);
    await fsp.mkdir(globalDir, { recursive: true });
    await fsp.writeFile(
      path.join(globalDir, ".socraticodecontextartifacts.json"),
      JSON.stringify({
        artifacts: [
          { name: "relative-art", path: "docs/schema.sql", description: "Relative path artifact" },
          { name: "absolute-art", path: "/absolute/path/schema.sql", description: "Absolute path artifact" },
        ],
      }),
    );

    const originalEnv = process.env.SOCRATICODE_GLOBAL_CONFIG_DIR;
    process.env.SOCRATICODE_GLOBAL_CONFIG_DIR = globalDir;
    try {
      const config = await loadConfig(projectDir);
      expect(config).not.toBeNull();
      const artifacts = config?.artifacts ?? [];
      // Relative path should be resolved against globalDir, not projectDir
      expect(path.isAbsolute(artifacts[0].path)).toBe(true);
      expect(artifacts[0].path).toBe(path.resolve(globalDir, "docs/schema.sql"));
      // Absolute path should remain unchanged
      expect(artifacts[1].path).toBe("/absolute/path/schema.sql");
    } finally {
      if (originalEnv === undefined) {
        delete process.env.SOCRATICODE_GLOBAL_CONFIG_DIR;
      } else {
        process.env.SOCRATICODE_GLOBAL_CONFIG_DIR = originalEnv;
      }
    }
  });

  it("does NOT resolve relative paths when using project-level config", async () => {
    const projectDir = await createTempProject({
      ".socraticodecontextartifacts.json": JSON.stringify({
        artifacts: [
          { name: "local-schema", path: "./schema.sql", description: "Local schema" },
        ],
      }),
    });
    const config = await loadConfig(projectDir);
    expect(config).not.toBeNull();
    const artifacts = config?.artifacts ?? [];
    // Project-level config should keep relative paths as-is (resolved downstream)
    expect(artifacts[0].path).toBe("./schema.sql");
  });

  it("prefers project-level config over global config", async () => {
    const globalDir = path.join(tempDir, `global-priority-${Date.now()}`);
    await fsp.mkdir(globalDir, { recursive: true });
    await fsp.writeFile(
      path.join(globalDir, ".socraticodecontextartifacts.json"),
      JSON.stringify({
        artifacts: [
          { name: "global-schema", path: "./global.sql", description: "Global" },
        ],
      }),
    );
    const projectDir = await createTempProject({
      ".socraticodecontextartifacts.json": JSON.stringify({
        artifacts: [
          { name: "project-schema", path: "./project.sql", description: "Project" },
        ],
      }),
    });

    const originalEnv = process.env.SOCRATICODE_GLOBAL_CONFIG_DIR;
    process.env.SOCRATICODE_GLOBAL_CONFIG_DIR = globalDir;
    try {
      const config = await loadConfig(projectDir);
      expect(config).not.toBeNull();
      expect(config?.artifacts?.[0].name).toBe("project-schema");
    } finally {
      if (originalEnv === undefined) {
        delete process.env.SOCRATICODE_GLOBAL_CONFIG_DIR;
      } else {
        process.env.SOCRATICODE_GLOBAL_CONFIG_DIR = originalEnv;
      }
    }
  });

  it("throws on duplicate artifact names (case-insensitive)", async () => {
    const projectDir = await createTempProject({
      ".socraticodecontextartifacts.json": JSON.stringify({
        artifacts: [
          { name: "Schema", path: "./a.sql", description: "First" },
          { name: "schema", path: "./b.sql", description: "Second" },
        ],
      }),
    });
    await expect(loadConfig(projectDir)).rejects.toThrow('duplicate artifact name "schema"');
  });
});

// ── readArtifactContent ─────────────────────────────────────────────────

describe("readArtifactContent", () => {
  it("reads a single file and returns content + hash", async () => {
    const projectDir = await createTempProject({
      "schema.sql": "CREATE TABLE users (id INT PRIMARY KEY);",
    });
    const { content, contentHash } = await readArtifactContent("./schema.sql", projectDir);
    expect(content).toBe("CREATE TABLE users (id INT PRIMARY KEY);");
    expect(contentHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("returns deterministic hash for same content", async () => {
    const projectDir = await createTempProject({
      "a.sql": "SELECT 1;",
      "b.sql": "SELECT 1;",
    });
    const r1 = await readArtifactContent("./a.sql", projectDir);
    const r2 = await readArtifactContent("./b.sql", projectDir);
    expect(r1.contentHash).toBe(r2.contentHash);
  });

  it("returns different hashes for different content", async () => {
    const projectDir = await createTempProject({
      "a.sql": "SELECT 1;",
      "b.sql": "SELECT 2;",
    });
    const r1 = await readArtifactContent("./a.sql", projectDir);
    const r2 = await readArtifactContent("./b.sql", projectDir);
    expect(r1.contentHash).not.toBe(r2.contentHash);
  });

  it("reads a directory and concatenates files with headers", async () => {
    const projectDir = await createTempProject({
      "deploy/service.yaml": "apiVersion: v1\nkind: Service",
      "deploy/deployment.yaml": "apiVersion: apps/v1\nkind: Deployment",
    });
    const { content, contentHash } = await readArtifactContent("./deploy", projectDir);
    expect(content).toContain("# ── deployment.yaml ──");
    expect(content).toContain("# ── service.yaml ──");
    expect(content).toContain("kind: Service");
    expect(content).toContain("kind: Deployment");
    expect(contentHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("reads nested directory files recursively", async () => {
    const projectDir = await createTempProject({
      "infra/main.tf": 'resource "aws_s3_bucket" "bucket" {}',
      "infra/modules/vpc/main.tf": 'resource "aws_vpc" "main" {}',
    });
    const { content } = await readArtifactContent("./infra", projectDir);
    expect(content).toContain("aws_s3_bucket");
    expect(content).toContain("aws_vpc");
  });

  it("throws for nonexistent path", async () => {
    const projectDir = await createTempProject({});
    await expect(readArtifactContent("./missing.sql", projectDir)).rejects.toThrow();
  });

  it("throws for empty directory", async () => {
    const projectDir = await createTempProject({});
    await fsp.mkdir(path.join(projectDir, "empty-dir"), { recursive: true });
    await expect(readArtifactContent("./empty-dir", projectDir)).rejects.toThrow("empty or contains no readable files");
  });

  it("supports absolute paths", async () => {
    const projectDir = await createTempProject({
      "data.json": '{"key": "value"}',
    });
    const absPath = path.join(projectDir, "data.json");
    const { content } = await readArtifactContent(absPath, projectDir);
    expect(content).toBe('{"key": "value"}');
  });
});

// ── chunkArtifactContent ────────────────────────────────────────────────

describe("chunkArtifactContent", () => {
  it("returns a single chunk for small content", () => {
    const content = "CREATE TABLE users (\n  id INT PRIMARY KEY,\n  name TEXT\n);";
    const chunks = chunkArtifactContent(content, "schema", "./schema.sql");
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe(content);
    expect(chunks[0].artifactName).toBe("schema");
    expect(chunks[0].startLine).toBe(1);
    expect(chunks[0].endLine).toBe(4);
  });

  it("produces valid UUID chunk IDs", () => {
    const content = "line1\nline2\nline3";
    const chunks = chunkArtifactContent(content, "test", "./test.txt");
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    for (const chunk of chunks) {
      expect(chunk.id).toMatch(uuidPattern);
    }
  });

  it("produces deterministic IDs for same inputs", () => {
    const content = "CREATE TABLE t1;\nCREATE TABLE t2;";
    const chunks1 = chunkArtifactContent(content, "schema", "./schema.sql");
    const chunks2 = chunkArtifactContent(content, "schema", "./schema.sql");
    expect(chunks1.map((c) => c.id)).toEqual(chunks2.map((c) => c.id));
  });

  it("splits large content into multiple overlapping chunks", () => {
    // Generate short lines so we don't hit MAX_CHUNK_CHARS truncation
    const lines = Array.from({ length: 250 }, (_, i) => `L${i}`);
    const content = lines.join("\n");
    const chunks = chunkArtifactContent(content, "schema", "./schema.sql");

    expect(chunks.length).toBeGreaterThan(1);

    // Verify overlap: last lines of chunk N should overlap with first lines of chunk N+1
    // CHUNK_SIZE = 100, CHUNK_OVERLAP = 10
    for (let i = 0; i < chunks.length - 1; i++) {
      const chunkLines = chunks[i].content.split("\n");
      const nextChunkLines = chunks[i + 1].content.split("\n");
      // The last OVERLAP lines of this chunk should appear at the start of the next
      const overlapFromCurrent = chunkLines.slice(-10);
      const overlapFromNext = nextChunkLines.slice(0, 10);
      expect(overlapFromCurrent).toEqual(overlapFromNext);
    }
  });

  it("handles empty content", () => {
    const chunks = chunkArtifactContent("", "test", "./test.txt");
    expect(chunks).toHaveLength(0);
  });

  it("handles single-line content", () => {
    const chunks = chunkArtifactContent("SELECT 1;", "test", "./test.sql");
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe("SELECT 1;");
  });

  it("sets correct line numbers", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`);
    const content = lines.join("\n");
    const chunks = chunkArtifactContent(content, "test", "./test.txt");
    expect(chunks[0].startLine).toBe(1);
    expect(chunks[0].endLine).toBe(50);
  });

  it("uses different artifactName for different artifacts", () => {
    const content = "SELECT 1;";
    const c1 = chunkArtifactContent(content, "schema-a", "./a.sql");
    const c2 = chunkArtifactContent(content, "schema-b", "./b.sql");
    expect(c1[0].artifactName).toBe("schema-a");
    expect(c2[0].artifactName).toBe("schema-b");
    // IDs should differ because artifact name and path differ
    expect(c1[0].id).not.toBe(c2[0].id);
  });
});

// ── contextCollectionName ────────────────────────────────────────────────

describe("contextCollectionName", () => {
  it("prefixes with context_", () => {
    expect(contextCollectionName("abc123def456")).toBe("context_abc123def456");
  });

  it("produces valid Qdrant-friendly collection names", () => {
    const name = contextCollectionName("abc123def456");
    expect(name).toMatch(/^[a-zA-Z0-9_-]+$/);
    expect(name).toMatch(/^context_[0-9a-f]{12}$/);
  });
});
