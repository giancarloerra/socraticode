// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited

/**
 * Unit tests for the ensureOllamaReady conditional guard in query-tools.ts.
 * Verifies that codebase_search only calls ensureOllamaReady() for the Ollama
 * provider, and uses getEmbeddingProvider() for OpenAI/Google.
 */

import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────

vi.mock("../../src/services/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ── embedding-config.js mock ─────────────────────────────────────────────

const mockGetEmbeddingConfig = vi.fn(() => ({
  embeddingProvider: "ollama" as string,
  embeddingModel: "test-model",
}));

vi.mock("../../src/services/embedding-config.js", () => ({
  getEmbeddingConfig: (...args: unknown[]) => mockGetEmbeddingConfig(...(args as [])),
}));

// ── embedding-provider.js mock ───────────────────────────────────────────

const mockGetEmbeddingProvider = vi.fn(async () => ({
  embed: vi.fn(),
  ensureReady: vi.fn(async () => ({ imagePulled: false, containerStarted: false, modelPulled: false })),
  health: vi.fn(),
}));

vi.mock("../../src/services/embedding-provider.js", () => ({
  getEmbeddingProvider: (...args: unknown[]) => mockGetEmbeddingProvider(...(args as [])),
}));

// ── ollama.js mock ───────────────────────────────────────────────────────

const mockEnsureOllamaReady = vi.fn(async () => ({
  modelPulled: false,
  containerStarted: false,
  imagePulled: false,
}));

vi.mock("../../src/services/ollama.js", () => ({
  ensureOllamaReady: (...args: unknown[]) => mockEnsureOllamaReady(...(args as [])),
}));

// ── docker.js mock ───────────────────────────────────────────────────────

vi.mock("../../src/services/docker.js", () => ({
  ensureQdrantReady: vi.fn(async () => ({ pulled: false, started: false })),
  isDockerAvailable: vi.fn(async () => true),
}));

// ── qdrant.js mock ───────────────────────────────────────────────────────

import type { SearchResult } from "../../src/types.js";

const mockSearchChunks = vi.fn(async (_collection: string, _query: string, _limit: number): Promise<SearchResult[]> => []);
const mockSearchMultipleCollections = vi.fn(async (): Promise<SearchResult[]> => []);

vi.mock("../../src/services/qdrant.js", () => ({
  searchChunks: (...args: unknown[]) => mockSearchChunks(...(args as [string, string, number])),
  searchMultipleCollections: (...args: unknown[]) => mockSearchMultipleCollections(...(args as [])),
  getCollectionInfo: vi.fn(async () => ({ points_count: 0 })),
  getProjectMetadata: vi.fn(async () => null),
}));

// ── config.js mock ───────────────────────────────────────────────────────

const mockResolveLinkedCollections = vi.fn(() => [
  { name: "codebase_abc123", label: "my-project" },
  { name: "codebase_def456", label: "shared-lib" },
]);

vi.mock("../../src/config.js", () => ({
  collectionName: vi.fn(() => "test-collection"),
  projectIdFromPath: vi.fn(() => "test-project-id"),
  resolveLinkedCollections: (...args: unknown[]) => mockResolveLinkedCollections(...(args as [])),
}));

// ── indexer.js mock ──────────────────────────────────────────────────────

vi.mock("../../src/services/indexer.js", () => ({
  isIndexingInProgress: vi.fn(() => false),
  getIndexingProgress: vi.fn(() => null),
  getLastCompleted: vi.fn(() => null),
}));

// ── code-graph.js mock ──────────────────────────────────────────────────

vi.mock("../../src/services/code-graph.js", () => ({
  getGraphStatus: vi.fn(async () => null),
}));

// ── context-artifacts.js mock ───────────────────────────────────────────

vi.mock("../../src/services/context-artifacts.js", () => ({
  getArtifactStatusSummary: vi.fn(async () => null),
}));

// ── watcher.js mock ──────────────────────────────────────────────────────

vi.mock("../../src/services/watcher.js", () => ({
  ensureWatcherStarted: vi.fn(),
  isWatching: vi.fn(() => false),
  isWatchedByAnyProcess: vi.fn(async () => false),
}));

// ── lock.js mock ─────────────────────────────────────────────────────────

vi.mock("../../src/services/lock.js", () => ({
  getLockHolderPid: vi.fn(async () => null),
}));

// ── constants.js mock ────────────────────────────────────────────────────

vi.mock("../../src/constants.js", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original };
});

// ── Imports (after mocks) ────────────────────────────────────────────────

import { handleQueryTool } from "../../src/tools/query-tools.js";

// ── Tests ────────────────────────────────────────────────────────────────

const TEST_PATH = "/tmp/test-project";

describe("codebase_search — embedding provider readiness guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls ensureOllamaReady when embeddingProvider is ollama", async () => {
    mockGetEmbeddingConfig.mockReturnValue({
      embeddingProvider: "ollama",
      embeddingModel: "test-model",
    });

    await handleQueryTool("codebase_search", {
      projectPath: TEST_PATH,
      query: "test query",
    });

    expect(mockEnsureOllamaReady).toHaveBeenCalledOnce();
    expect(mockGetEmbeddingProvider).not.toHaveBeenCalled();
  });

  it("calls getEmbeddingProvider (not ensureOllamaReady) when embeddingProvider is openai", async () => {
    mockGetEmbeddingConfig.mockReturnValue({
      embeddingProvider: "openai",
      embeddingModel: "text-embedding-3-small",
    });

    await handleQueryTool("codebase_search", {
      projectPath: TEST_PATH,
      query: "test query",
    });

    expect(mockEnsureOllamaReady).not.toHaveBeenCalled();
    expect(mockGetEmbeddingProvider).toHaveBeenCalledOnce();
  });

  it("calls getEmbeddingProvider (not ensureOllamaReady) when embeddingProvider is google", async () => {
    mockGetEmbeddingConfig.mockReturnValue({
      embeddingProvider: "google",
      embeddingModel: "gemini-embedding-001",
    });

    await handleQueryTool("codebase_search", {
      projectPath: TEST_PATH,
      query: "test query",
    });

    expect(mockEnsureOllamaReady).not.toHaveBeenCalled();
    expect(mockGetEmbeddingProvider).toHaveBeenCalledOnce();
  });
});

// ── includeLinked tests ──────────────────────────────────────────────────

describe("codebase_search — includeLinked parameter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: ollama provider
    mockGetEmbeddingConfig.mockReturnValue({
      embeddingProvider: "ollama",
      embeddingModel: "test-model",
    });
  });

  it("calls searchChunks (not searchMultipleCollections) when includeLinked is omitted", async () => {
    await handleQueryTool("codebase_search", {
      projectPath: TEST_PATH,
      query: "test query",
    });

    expect(mockSearchChunks).toHaveBeenCalledOnce();
    expect(mockSearchMultipleCollections).not.toHaveBeenCalled();
    expect(mockResolveLinkedCollections).not.toHaveBeenCalled();
  });

  it("calls searchChunks (not searchMultipleCollections) when includeLinked is false", async () => {
    await handleQueryTool("codebase_search", {
      projectPath: TEST_PATH,
      query: "test query",
      includeLinked: false,
    });

    expect(mockSearchChunks).toHaveBeenCalledOnce();
    expect(mockSearchMultipleCollections).not.toHaveBeenCalled();
    expect(mockResolveLinkedCollections).not.toHaveBeenCalled();
  });

  it("calls searchMultipleCollections when includeLinked is true", async () => {
    await handleQueryTool("codebase_search", {
      projectPath: TEST_PATH,
      query: "test query",
      includeLinked: true,
    });

    expect(mockSearchMultipleCollections).toHaveBeenCalledOnce();
    expect(mockResolveLinkedCollections).toHaveBeenCalledOnce();
    expect(mockSearchChunks).not.toHaveBeenCalled();
  });

  it("passes collections from resolveLinkedCollections to searchMultipleCollections", async () => {
    await handleQueryTool("codebase_search", {
      projectPath: TEST_PATH,
      query: "find me",
      includeLinked: true,
      limit: 5,
    });

    expect(mockResolveLinkedCollections).toHaveBeenCalledWith(
      expect.stringContaining(path.resolve(TEST_PATH)),
    );
    expect(mockSearchMultipleCollections).toHaveBeenCalledWith(
      [
        { name: "codebase_abc123", label: "my-project" },
        { name: "codebase_def456", label: "shared-lib" },
      ],
      "find me",
      5,
      undefined, // fileFilter
      undefined, // languageFilter
    );
  });

  it("includes project label in output when results have project field", async () => {
    mockSearchMultipleCollections.mockResolvedValueOnce([
      {
        filePath: "/proj/src/index.ts",
        relativePath: "src/index.ts",
        content: "console.log('hello')",
        startLine: 1,
        endLine: 5,
        language: "typescript",
        score: 0.5,
        project: "shared-lib",
      },
    ]);

    const output = await handleQueryTool("codebase_search", {
      projectPath: TEST_PATH,
      query: "hello",
      includeLinked: true,
    });

    expect(output).toContain("[shared-lib]");
    expect(output).toContain("src/index.ts");
  });

  it("does not include project tag when project field is absent", async () => {
    mockSearchChunks.mockResolvedValueOnce([
      {
        filePath: "/proj/src/index.ts",
        relativePath: "src/index.ts",
        content: "console.log('hello')",
        startLine: 1,
        endLine: 5,
        language: "typescript",
        score: 0.5,
      },
    ]);

    const output = await handleQueryTool("codebase_search", {
      projectPath: TEST_PATH,
      query: "hello",
    });

    // Should have the file but no project tag brackets
    expect(output).toContain("src/index.ts");
    expect(output).not.toMatch(/\[[^\]]+\]\s*src\//); // no [project-name] tag before file path
  });
});
