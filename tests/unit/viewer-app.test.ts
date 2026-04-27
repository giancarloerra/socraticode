// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited

/**
 * Regression test for the bundled viewer-app.js — runs it in a mocked
 * DOM/Cytoscape environment and asserts it loads without throwing.
 *
 * This catches TDZ ("Cannot access 'X' before initialization") errors
 * introduced by declaring a `const`/`let` after it's used inside a style
 * closure that Cytoscape evaluates during the `cy = cytoscape({...})`
 * constructor call. The standard unit tests on `graph-visualize-html.ts`
 * check the generated HTML's structure but never execute the script, so
 * runtime errors like that only surface when a browser loads the page.
 *
 * Uses Node's `vm` module for a sandboxed evaluation — the viewer source
 * is trusted (we ship it ourselves) but isolating the globals keeps the
 * test safe and deterministic.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const VIEWER_JS_PATH = path.resolve(__dirname, "../../src/assets/viewer-app.js");

describe("viewer-app.js", () => {
  it("executes top-to-bottom without TDZ or reference errors", () => {
    const src = readFileSync(VIEWER_JS_PATH, "utf-8");

    // ── Mock DOM ────────────────────────────────────────────────────
    const makeEl = (id: string) => ({
      id,
      className: "",
      classList: { add: () => {}, remove: () => {}, toggle: () => {} },
      style: {},
      disabled: false,
      title: "",
      textContent: "",
      firstChild: null as null | object,
      dataset: {} as Record<string, string>,
      addEventListener: () => {},
      appendChild: () => {},
      removeChild: () => {},
      setAttribute: () => {},
      removeAttribute: () => {},
    });
    const elements = new Map<string, ReturnType<typeof makeEl>>();
    const doc = {
      createElement: () => makeEl("created"),
      createTextNode: () => ({}),
      getElementById: (id: string) => {
        if (!elements.has(id)) elements.set(id, makeEl(id));
        return elements.get(id);
      },
      querySelectorAll: () => [] as unknown[],
    };

    // ── Mock Cytoscape — exercises every style closure on a fake ele ──
    const closureErrors: string[] = [];
    const makeFakeCy = () => ({
      on: () => {},
      zoom: () => 1,
      width: () => 800,
      height: () => 600,
      elements: () => ({
        remove: () => {},
        addClass: () => {},
        removeClass: () => {},
        difference: () => ({
          addClass: () => {},
          nodes: () => ({ difference: () => ({ addClass: () => {} }) }),
          edges: () => ({ addClass: () => {} }),
        }),
      }),
      nodes: () => ({ forEach: () => {}, length: 0, filter: () => [] as unknown[] }),
      getElementById: () => ({ empty: () => true }),
      add: () => {},
      fit: () => {},
      style: () => ({ update: () => {} }),
      layout: () => ({ one: () => {}, run: () => {} }),
      batch: (fn: () => void) => fn(),
      png: () => "data:,",
      animate: () => {},
    });

    const fakeCy = (config: { style?: Array<{ selector: string; style?: Record<string, unknown> }> }) => {
      const instance = makeFakeCy();
      const fakeEle = { data: () => "x", hasClass: () => false, cy: () => instance };
      // Exercise every function-typed style value. Any TDZ or reference
      // error surfaces here as a collected closureErrors entry.
      for (const rule of config.style ?? []) {
        for (const [key, val] of Object.entries(rule.style ?? {})) {
          if (typeof val === "function") {
            try { (val as (ele: unknown) => unknown)(fakeEle); }
            catch (e) { closureErrors.push(`${rule.selector} → ${key}: ${(e as Error).message}`); }
          }
        }
      }
      return instance;
    };

    const data = {
      project: { name: "smoke" },
      files: [{ id: "a.ts", label: "a.ts", language: "typescript", deps: 0, dependents: 0, symbolCount: 0 }],
      fileEdges: [],
      symbols: [],
      symbolEdges: [],
      symbolsByFile: {},
      symbolMode: "full" as const,
    };

    const ctx = {
      document: doc,
      cytoscape: fakeCy,
      window: { __SOCRATICODE_DATA__: data, cytoscapeDagre: () => {} },
      console: { log: () => {}, warn: () => {}, error: () => {} },
    };

    // Throws if the viewer hits TDZ or any other top-level error.
    expect(() => runInNewContext(src, ctx, { filename: "viewer-app.js" })).not.toThrow();
    expect(closureErrors).toEqual([]);
  });
});
