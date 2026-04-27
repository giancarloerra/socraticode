// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited

/**
 * End-to-end scale test for the symbol graph.
 *
 * Generates a synthetic Python project with N files × M symbols/file and
 * measures full-stack build & query times against a real Qdrant instance.
 * Default: 1000 files × 20 symbols/file = 20,000 symbols.
 *
 * Larger targets (10k files / 200k symbols) are gated behind
 * `SCALE_LARGE=1` and disabled in CI by default — they take 1–2 min and
 * are intended for manual perf investigations only.
 *
 * What's verified end-to-end:
 *   1. Full rebuild (extract + resolve + persist sharded payloads) finishes
 *      under a generous wall-clock budget.
 *   2. Symbol-graph meta is persisted with the expected counts.
 *   3. Cold queries (codebase_impact / codebase_symbol via the cache) return
 *      results within a small budget after a fresh process state.
 *   4. Phase F incremental update for a single changed file is at least
 *      4× faster than a full rebuild (the whole point of Phase F).
 *
 * Skipped automatically when Docker is unavailable.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { projectIdFromPath } from "../../src/config.js";
import {
  invalidateGraphCache,
  rebuildGraph,
} from "../../src/services/code-graph.js";
import {
  getImpactRadius,
  listSymbols,
} from "../../src/services/graph-impact.js";
import {
  dropSymbolGraphCache,
  getSymbolGraphCache,
} from "../../src/services/symbol-graph-cache.js";
import { updateChangedFilesSymbolGraph } from "../../src/services/symbol-graph-incremental.js";
import {
  deleteSymbolGraphData,
  loadSymbolGraphMeta,
} from "../../src/services/symbol-graph-store.js";
import { isDockerAvailable } from "../helpers/fixtures.js";
import { waitForQdrant } from "../helpers/setup.js";

const dockerAvailable = isDockerAvailable();
const LARGE = process.env.SCALE_LARGE === "1";

const N_FILES = LARGE ? 10_000 : 1_000;
const SYMBOLS_PER_FILE = LARGE ? 20 : 20;
const TOTAL_SYMBOLS = N_FILES * SYMBOLS_PER_FILE;

// Wall-clock budgets (intentionally loose — we only fail on order-of-magnitude regressions).
const FULL_REBUILD_BUDGET_MS = LARGE ? 10 * 60_000 : 90_000; // 90s for 1k files locally; 10min for 10k
const COLD_QUERY_BUDGET_MS = 5_000;
const INCREMENTAL_SPEEDUP_MIN = 4; // Phase F must beat full rebuild by ≥4×

/**
 * Generate a Python project with N files. Each file imports the *previous*
 * file (creates a long dependency chain) and defines `SYMBOLS_PER_FILE`
 * functions, the last of which calls a function from the imported module.
 * This produces real cross-file edges so the symbol graph is non-trivial.
 */
function generateSyntheticProject(root: string): void {
  fs.mkdirSync(path.join(root, "pkg"), { recursive: true });
  // Empty __init__ so the package is importable.
  fs.writeFileSync(path.join(root, "pkg", "__init__.py"), "", "utf-8");

  for (let i = 0; i < N_FILES; i++) {
    const fns: string[] = [];
    if (i > 0) {
      fns.push(`from pkg.mod_${i - 1} import fn_${i - 1}_0`);
    }
    for (let j = 0; j < SYMBOLS_PER_FILE; j++) {
      const callsPrev =
        j === SYMBOLS_PER_FILE - 1 && i > 0 ? `    fn_${i - 1}_0()\n` : "";
      fns.push(`def fn_${i}_${j}():\n${callsPrev}    return ${i * 100 + j}`);
    }
    fs.writeFileSync(
      path.join(root, "pkg", `mod_${i}.py`),
      `${fns.join("\n\n")}\n`,
      "utf-8",
    );
  }
}

describe.skipIf(!dockerAvailable)(
  "symbol-graph end-to-end scale",
  { timeout: LARGE ? 30 * 60_000 : 5 * 60_000 },
  () => {
    let projectRoot: string;
    let projectId: string;
    let fullRebuildMs: number;

    beforeAll(async () => {
      await waitForQdrant();
      projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "socraticode-scale-"));
      projectId = projectIdFromPath(projectRoot);
      // Clean any prior state for this project id (defensive — tmpdir
      // randomises but Qdrant collections may linger from prior crashes).
      try { await deleteSymbolGraphData(projectId); } catch { /* ignore */ }
      generateSyntheticProject(projectRoot);
    }, 60_000);

    afterAll(async () => {
      try { await deleteSymbolGraphData(projectId); } catch { /* ignore */ }
      invalidateGraphCache(projectRoot);
      dropSymbolGraphCache(projectId);
      try { fs.rmSync(projectRoot, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    it(`builds the symbol graph for ${N_FILES} files / ${TOTAL_SYMBOLS} symbols within budget`, async () => {
      const start = Date.now();
      await rebuildGraph(projectRoot);
      fullRebuildMs = Date.now() - start;
      // Log so the number shows up in test output even on success.
      console.log(`[scale] Full rebuild: ${N_FILES} files / ${TOTAL_SYMBOLS} symbols in ${fullRebuildMs} ms`);
      expect(fullRebuildMs).toBeLessThan(FULL_REBUILD_BUDGET_MS);

      const meta = await loadSymbolGraphMeta(projectId);
      expect(meta).not.toBeNull();
      // Each file contributes SYMBOLS_PER_FILE non-<module> symbols.
      // Plus the package __init__.py (1 file, 0 symbols).
      expect(meta?.symbolCount ?? 0).toBeGreaterThanOrEqual(TOTAL_SYMBOLS - 5);
    });

    it("answers cold codebase_symbols / codebase_impact queries within budget", async () => {
      // Drop the in-memory cache so we exercise the persisted-shard path.
      dropSymbolGraphCache(projectId);
      const cache = await getSymbolGraphCache(projectId);
      expect(cache).not.toBeNull();
      if (!cache) return;

      const t1 = Date.now();
      const symbols = await listSymbols(cache, { query: "fn_500_5", limit: 10 });
      const listMs = Date.now() - t1;
      console.log(`[scale] Cold listSymbols("fn_500_5"): ${symbols.length} hits in ${listMs} ms`);
      expect(listMs).toBeLessThan(COLD_QUERY_BUDGET_MS);
      expect(symbols.length).toBeGreaterThan(0);

      const t2 = Date.now();
      const impact = await getImpactRadius(cache, "fn_500_0", 3);
      const impactMs = Date.now() - t2;
      console.log(`[scale] Cold getImpactRadius("fn_500_0", depth=3): ${impact.totalFiles} files in ${impactMs} ms`);
      expect(impactMs).toBeLessThan(COLD_QUERY_BUDGET_MS);
    });

    it("Phase F incremental update is significantly faster than a full rebuild", async () => {
      // Touch one file: append a new symbol.
      const rel = "pkg/mod_42.py";
      const abs = path.join(projectRoot, rel);
      const original = fs.readFileSync(abs, "utf-8");
      fs.writeFileSync(
        abs,
        `${original}\ndef fn_42_${SYMBOLS_PER_FILE}_inc():\n    return -1\n`,
        "utf-8",
      );
      try {
        // Build a fresh file-import graph (cheap part of Phase F) and time
        // only the per-file symbol patch.
        const graph = await rebuildGraph(projectRoot, { skipSymbolGraph: true });

        const start = Date.now();
        const result = await updateChangedFilesSymbolGraph(
          projectId,
          projectRoot,
          graph,
          [rel],
          [],
        );
        const incrementalMs = Date.now() - start;
        console.log(`[scale] Phase F incremental update (1 file in ${N_FILES}-file repo): ${incrementalMs} ms (full rebuild was ${fullRebuildMs} ms)`);
        expect(result.fullRebuildRequired).toBe(false);
        expect(result.filesChanged).toBeGreaterThanOrEqual(1);
        // Phase F's whole reason to exist: must beat full rebuild on a small
        // change set by a wide margin. We allow 4× as a deliberately loose
        // threshold to avoid CI flakiness.
        expect(incrementalMs * INCREMENTAL_SPEEDUP_MIN).toBeLessThan(fullRebuildMs);
      } finally {
        fs.writeFileSync(abs, original, "utf-8");
      }
    });
  },
);
