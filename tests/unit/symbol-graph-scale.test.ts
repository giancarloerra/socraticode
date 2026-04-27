// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited

/**
 * Symbol-graph scale & smoke benchmarks.
 *
 * These are CPU-only synthetic benchmarks — they exercise the sharding
 * helpers, hash function, and in-memory shard packing using realistic
 * volumes (10k–100k symbols). They do NOT hit Qdrant; that path is covered
 * by the Qdrant-backed integration tests in
 * `tests/integration/symbol-graph-incremental.test.ts`.
 *
 * Goal: catch order-of-magnitude regressions in the sharding/hashing layer
 * before they reach a real codebase. Thresholds are deliberately loose to
 * avoid CI flakiness — we only fail on >10× slowdowns.
 */

import { describe, expect, it } from "vitest";
import {
  contentHashOf,
  nameShardKey,
  reverseShardKey,
} from "../../src/services/symbol-graph-store.js";

describe("symbol-graph scale benchmarks", () => {
  it("nameShardKey handles 100k names quickly with even distribution", () => {
    const buckets = new Map<string, number>();
    const N = 100_000;
    const start = process.hrtime.bigint();
    const ALPHA = "abcdefghijklmnopqrstuvwxyz_";
    for (let i = 0; i < N; i++) {
      // Spread first character across all 27 shard buckets.
      const first = ALPHA[i % ALPHA.length];
      const name = `${first}${i.toString(36)}`;
      const key = nameShardKey(name);
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    // 100k name-key calls should complete in well under 1s on any modern CPU.
    expect(elapsedMs).toBeLessThan(1000);
    // Distribution: at least 20 distinct shard buckets must be hit.
    expect(buckets.size).toBeGreaterThan(20);
  });

  it("reverseShardKey distributes 50k file paths across hundreds of buckets", () => {
    const buckets = new Map<number, number>();
    const N = 50_000;
    const start = process.hrtime.bigint();
    for (let i = 0; i < N; i++) {
      const filePath = `src/module_${i % 500}/file_${i}.ts`;
      const bucket = reverseShardKey(filePath);
      buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
    }
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    expect(elapsedMs).toBeLessThan(2000);
    // SHA-256 mod 256 should hit a wide spread of buckets.
    expect(buckets.size).toBeGreaterThan(150);
  });

  it("contentHashOf processes 10MB of synthetic source under a 5s budget", () => {
    const N = 1000;
    // ~10KB per file × 1000 files = ~10MB total.
    const source = "function foo() { return 1; }\n".repeat(350);
    const start = process.hrtime.bigint();
    let lastHash = "";
    for (let i = 0; i < N; i++) {
      lastHash = contentHashOf(source + i);
    }
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    expect(elapsedMs).toBeLessThan(5000);
    expect(lastHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("packing 10k symbols into name shards stays under 200ms", () => {
    // Simulates the in-memory shard map build that persistSymbolGraph does
    // before the network round-trip.
    const ALPHA = "abcdefghijklmnopqrstuvwxyz_";
    const N = 10_000;
    const shards: Record<string, Array<{ file: string; id: string }>> = {};
    const start = process.hrtime.bigint();
    for (let i = 0; i < N; i++) {
      const first = ALPHA[i % ALPHA.length];
      const name = `${first}sym_${i.toString(36)}`;
      const key = nameShardKey(name);
      let bucket = shards[key];
      if (!bucket) {
        bucket = [];
        shards[key] = bucket;
      }
      bucket.push({ file: `src/file_${i % 1000}.ts`, id: `src/file_${i}.ts::${name}` });
    }
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    expect(elapsedMs).toBeLessThan(200);
    expect(Object.keys(shards).length).toBeGreaterThan(10);
  });

  it("memory headroom: 100k payload-shaped objects fit under 200MB heap", () => {
    // Sanity check that the in-memory shape we build at scale doesn't blow up.
    const N = 100_000;
    const before = process.memoryUsage().heapUsed;
    const arr: Array<{ file: string; line: number; name: string }> = [];
    for (let i = 0; i < N; i++) {
      arr.push({ file: `src/m${i % 1000}/f${i}.ts`, line: i % 500, name: `s${i}` });
    }
    const after = process.memoryUsage().heapUsed;
    const deltaMB = (after - before) / (1024 * 1024);
    expect(deltaMB).toBeLessThan(200);
    expect(arr.length).toBe(N);
  });
});
