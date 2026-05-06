// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited

import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ArtifactIndexState } from "../../src/types.js";

let tempDir: string;
let existingMetadata: ArtifactIndexState[] | null = null;
const saveCalls: ArtifactIndexState[][] = [];

vi.mock("../../src/services/embeddings.js", () => ({
  generateEmbeddings: vi.fn(async (texts: string[]) =>
    texts.map(() => [0.1, 0.2, 0.3]),
  ),
  prepareDocumentText: vi.fn((content: string, filePath: string) =>
    `search_document: ${filePath}\n${content}`,
  ),
}));

vi.mock("../../src/services/qdrant.js", () => ({
  deleteArtifactChunks: vi.fn(async () => undefined),
  deleteCollection: vi.fn(async () => undefined),
  deleteContextMetadata: vi.fn(async () => undefined),
  ensureCollection: vi.fn(async () => undefined),
  ensurePayloadIndex: vi.fn(async () => undefined),
  getCollectionInfo: vi.fn(async () => ({ pointsCount: 1 })),
  loadContextMetadata: vi.fn(async () => existingMetadata),
  saveContextMetadata: vi.fn(async (
    _collection: string,
    _projectPath: string,
    artifacts: ArtifactIndexState[],
  ) => {
    saveCalls.push([...artifacts]);
    existingMetadata = [...artifacts];
  }),
  searchChunks: vi.fn(async () => []),
  searchChunksWithFilter: vi.fn(async () => []),
  upsertPreEmbeddedChunks: vi.fn(async () => ({ pointsSkipped: 0 })),
}));

const { ensureArtifactsIndexed, indexAllArtifacts } = await import(
  "../../src/services/context-artifacts.js"
);

beforeEach(async () => {
  existingMetadata = null;
  saveCalls.length = 0;
  tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "socraticode-checkpoint-test-"));
});

afterEach(async () => {
  await fsp.rm(tempDir, { recursive: true, force: true });
});

async function createProject(files: Record<string, string>): Promise<string> {
  const projectDir = path.join(tempDir, `proj-${Math.random().toString(36).slice(2)}`);
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(projectDir, filePath);
    await fsp.mkdir(path.dirname(fullPath), { recursive: true });
    await fsp.writeFile(fullPath, content);
  }
  return projectDir;
}

describe("context artifact metadata checkpoints", () => {
  it("saves metadata after each artifact during full indexing", async () => {
    const projectDir = await createProject({
      ".socraticodecontextartifacts.json": JSON.stringify({
        artifacts: [
          { name: "a", path: "./a.md", description: "Artifact A" },
          { name: "b", path: "./b.md", description: "Artifact B" },
        ],
      }),
      "a.md": "# A",
      "b.md": "# B",
    });

    const { indexed, errors } = await indexAllArtifacts(projectDir);

    expect(errors).toHaveLength(0);
    expect(indexed.map((a) => a.name)).toEqual(["a", "b"]);
    expect(saveCalls.length).toBeGreaterThanOrEqual(2);
    expect(saveCalls[0].map((a) => a.name)).toEqual(["a"]);
    expect(saveCalls[1].map((a) => a.name)).toEqual(["a", "b"]);
  });

  it("keeps a successful artifact checkpoint when a later artifact fails", async () => {
    const projectDir = await createProject({
      ".socraticodecontextartifacts.json": JSON.stringify({
        artifacts: [
          { name: "ok", path: "./ok.md", description: "OK artifact" },
          { name: "missing", path: "./missing.md", description: "Missing artifact" },
        ],
      }),
      "ok.md": "# OK",
    });

    const { indexed, errors } = await indexAllArtifacts(projectDir);

    expect(indexed.map((a) => a.name)).toEqual(["ok"]);
    expect(errors.map((e) => e.name)).toEqual(["missing"]);
    expect(saveCalls[0].map((a) => a.name)).toEqual(["ok"]);
  });

  it("preserves existing states while checkpointing stale artifacts", async () => {
    const projectDir = await createProject({
      ".socraticodecontextartifacts.json": JSON.stringify({
        artifacts: [
          { name: "changed", path: "./changed.md", description: "Changed artifact" },
          { name: "same", path: "./same.md", description: "Same artifact" },
        ],
      }),
      "changed.md": "# Changed",
      "same.md": "# Same",
    });

    const { readArtifactContent } = await import("../../src/services/context-artifacts.js");
    const same = await readArtifactContent("./same.md", projectDir);
    existingMetadata = [
      {
        name: "changed",
        description: "Changed artifact",
        resolvedPath: path.join(projectDir, "changed.md"),
        contentHash: "stale-hash",
        lastIndexedAt: "2026-01-01T00:00:00.000Z",
        chunksIndexed: 1,
      },
      {
        name: "same",
        description: "Same artifact",
        resolvedPath: path.join(projectDir, "same.md"),
        contentHash: same.contentHash,
        lastIndexedAt: "2026-01-01T00:00:00.000Z",
        chunksIndexed: 1,
      },
    ];

    const result = await ensureArtifactsIndexed(projectDir);

    expect(result.reindexed).toEqual(["changed"]);
    expect(result.upToDate).toEqual(["same"]);
    expect(saveCalls[0].map((a) => a.name).sort()).toEqual(["changed", "same"]);
  });
});
