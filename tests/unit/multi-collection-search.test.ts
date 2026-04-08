// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited

/**
 * Unit tests for mergeMultiCollectionResults — client-side RRF fusion
 * and deduplication across multiple collection result sets.
 * Tests the pure function directly (no mocks needed).
 */

import { describe, expect, it } from "vitest";
import type { SearchResult } from "../../src/types.js";
import { mergeMultiCollectionResults } from "../../src/services/qdrant.js";

// ── Helpers ─────────────────────────────────────────────────────────────

function makeResult(relativePath: string, score: number, overrides?: Partial<SearchResult>): SearchResult {
  return {
    filePath: `/project/${relativePath}`,
    relativePath,
    content: `content of ${relativePath}`,
    startLine: 1,
    endLine: 10,
    language: "typescript",
    score,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("mergeMultiCollectionResults", () => {
  it("returns empty array for empty input", () => {
    const results = mergeMultiCollectionResults([], 10);
    expect(results).toEqual([]);
  });

  it("returns results from a single collection with project label", () => {
    const results = mergeMultiCollectionResults(
      [
        {
          label: "my-project",
          results: [
            makeResult("src/index.ts", 0.85),
            makeResult("src/utils.ts", 0.72),
          ],
        },
      ],
      10,
    );

    expect(results).toHaveLength(2);
    expect(results[0].project).toBe("my-project");
    expect(results[1].project).toBe("my-project");
    expect(results[0].relativePath).toBe("src/index.ts");
    expect(results[1].relativePath).toBe("src/utils.ts");
  });

  it("merges results from two collections — all unique files present", () => {
    const results = mergeMultiCollectionResults(
      [
        {
          label: "project-a",
          results: [
            makeResult("src/file1.ts", 0.90),
            makeResult("src/file2.ts", 0.80),
          ],
        },
        {
          label: "project-b",
          results: [
            makeResult("src/file3.ts", 0.95),
            makeResult("src/file4.ts", 0.70),
          ],
        },
      ],
      10,
    );

    expect(results).toHaveLength(4);
    const paths = results.map((r) => r.relativePath);
    expect(paths).toContain("src/file1.ts");
    expect(paths).toContain("src/file2.ts");
    expect(paths).toContain("src/file3.ts");
    expect(paths).toContain("src/file4.ts");

    // Correct project labels
    expect(results.find((r) => r.relativePath === "src/file1.ts")?.project).toBe("project-a");
    expect(results.find((r) => r.relativePath === "src/file3.ts")?.project).toBe("project-b");
  });

  it("deduplicates by relativePath — first (higher-priority) collection wins", () => {
    const results = mergeMultiCollectionResults(
      [
        {
          label: "project-a",
          results: [makeResult("src/shared.ts", 0.90, { content: "content from A" })],
        },
        {
          label: "project-b",
          results: [makeResult("src/shared.ts", 0.85, { content: "content from B" })],
        },
      ],
      10,
    );

    const sharedResults = results.filter((r) => r.relativePath === "src/shared.ts");
    expect(sharedResults).toHaveLength(1);
    expect(sharedResults[0].content).toBe("content from A");
    expect(sharedResults[0].project).toBe("project-a");
  });

  it("RRF scores accumulate for files appearing in multiple collections", () => {
    const results = mergeMultiCollectionResults(
      [
        {
          label: "project-a",
          results: [
            makeResult("src/popular.ts", 0.90),
            makeResult("src/only-a.ts", 0.80),
          ],
        },
        {
          label: "project-b",
          results: [
            makeResult("src/popular.ts", 0.85),
            makeResult("src/only-b.ts", 0.75),
          ],
        },
      ],
      10,
    );

    // popular.ts should rank first due to accumulated RRF score from both collections
    expect(results[0].relativePath).toBe("src/popular.ts");
    // Its score should be higher than single-collection results
    expect(results[0].score).toBeGreaterThan(results[1].score);
    // The accumulated score = 1/(60+1) + 1/(60+1) = 2 * 1/61 ≈ 0.0328
    const expectedAccumulated = 2 * (1 / 61);
    expect(results[0].score).toBeCloseTo(expectedAccumulated, 6);
  });

  it("respects the limit parameter", () => {
    const results = mergeMultiCollectionResults(
      [
        {
          label: "a",
          results: [
            makeResult("src/a1.ts", 0.9),
            makeResult("src/a2.ts", 0.8),
            makeResult("src/a3.ts", 0.7),
          ],
        },
        {
          label: "b",
          results: [
            makeResult("src/b1.ts", 0.95),
            makeResult("src/b2.ts", 0.85),
            makeResult("src/b3.ts", 0.75),
          ],
        },
      ],
      3,
    );

    expect(results).toHaveLength(3);
  });

  it("results are sorted by fused RRF score descending", () => {
    const results = mergeMultiCollectionResults(
      [
        {
          label: "a",
          results: [
            makeResult("src/first.ts", 0.90),
            makeResult("src/second.ts", 0.80),
          ],
        },
        {
          label: "b",
          results: [
            makeResult("src/third.ts", 0.95),
          ],
        },
      ],
      10,
    );

    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it("handles three collections", () => {
    const results = mergeMultiCollectionResults(
      [
        { label: "a", results: [makeResult("src/a.ts", 0.9)] },
        { label: "b", results: [makeResult("src/b.ts", 0.8)] },
        { label: "c", results: [makeResult("src/c.ts", 0.7)] },
      ],
      10,
    );

    expect(results).toHaveLength(3);
    expect(results.map((r) => r.project)).toEqual(
      expect.arrayContaining(["a", "b", "c"]),
    );
  });

  it("handles empty results from some collections", () => {
    const results = mergeMultiCollectionResults(
      [
        { label: "a", results: [makeResult("src/a.ts", 0.9)] },
        { label: "b", results: [] },
        { label: "c", results: [makeResult("src/c.ts", 0.7)] },
      ],
      10,
    );

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.project)).toEqual(
      expect.arrayContaining(["a", "c"]),
    );
  });
});
