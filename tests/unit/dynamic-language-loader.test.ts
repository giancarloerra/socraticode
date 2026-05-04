// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited
//
// Tests for the dynamic ast-grep grammar loader.
//
// Background: in 1.8.3 the loader called `registerDynamicLanguage` once with
// every loaded grammar in a single batch. Per `@ast-grep/napi`, that call is
// atomic: a single throwing `libraryPath` getter aborts the whole batch and
// no grammar gets registered. On environments where one prebuilt binary is
// missing for the host architecture, this manifested as all dynamic
// languages being silently broken (issue #43).
//
// 1.8.4 fixes this by pre-validating each grammar's `libraryPath` getter in
// the inner per-grammar try/catch so a missing prebuild is contained to that
// one grammar. The `getDynamicLanguageStatus` API exposes which grammars
// registered successfully and which failed (with the underlying reason),
// surfaced in `codebase_graph_status`.

import { beforeAll, describe, expect, it } from "vitest";
import {
  ensureDynamicLanguages,
  getDynamicLanguageStatus,
} from "../../src/services/code-graph.js";

beforeAll(() => {
  ensureDynamicLanguages();
});

describe("dynamic-language-loader", () => {
  describe("ensureDynamicLanguages", () => {
    it("is synchronous (returns void, not a Promise)", () => {
      const result = ensureDynamicLanguages();
      expect(result).toBeUndefined();
    });

    it("is idempotent — calling repeatedly does not change registration state", () => {
      const before = getDynamicLanguageStatus();
      ensureDynamicLanguages();
      ensureDynamicLanguages();
      const after = getDynamicLanguageStatus();

      expect(after.loaded).toEqual(before.loaded);
      expect(after.failed.map((f) => f.name)).toEqual(before.failed.map((f) => f.name));
    });
  });

  describe("getDynamicLanguageStatus", () => {
    it("returns loaded and failed arrays", () => {
      const status = getDynamicLanguageStatus();
      expect(status).toHaveProperty("loaded");
      expect(status).toHaveProperty("failed");
      expect(Array.isArray(status.loaded)).toBe(true);
      expect(Array.isArray(status.failed)).toBe(true);
    });

    it("loaded entries are unique strings", () => {
      const status = getDynamicLanguageStatus();
      const seen = new Set<string>();
      for (const name of status.loaded) {
        expect(typeof name).toBe("string");
        expect(seen.has(name)).toBe(false);
        seen.add(name);
      }
    });

    it("failed entries each include name and error", () => {
      const status = getDynamicLanguageStatus();
      for (const f of status.failed) {
        expect(typeof f.name).toBe("string");
        expect(typeof f.error).toBe("string");
        expect(f.error.length).toBeGreaterThan(0);
      }
    });

    it("loaded list is sorted alphabetically", () => {
      const status = getDynamicLanguageStatus();
      const sorted = [...status.loaded].sort();
      expect(status.loaded).toEqual(sorted);
    });

    it("failed list is sorted alphabetically by name", () => {
      const status = getDynamicLanguageStatus();
      const names = status.failed.map((f) => f.name);
      const sorted = [...names].sort();
      expect(names).toEqual(sorted);
    });

    it("loaded and failed sets are disjoint", () => {
      const status = getDynamicLanguageStatus();
      const failedNames = new Set(status.failed.map((f) => f.name));
      for (const loaded of status.loaded) {
        expect(failedNames.has(loaded)).toBe(false);
      }
    });

    it("at least one expected dynamic grammar registers in this environment", () => {
      // On every supported dev environment for this repo (macOS, common
      // Linux distros), the pre-validation step should let at least a few
      // of these load successfully. If this fails, either the environment
      // is unusual (and we want to know) or there is a real regression in
      // the loader.
      const status = getDynamicLanguageStatus();
      const loaded = new Set(status.loaded);
      const expected = ["python", "go", "java", "php", "ruby"];
      const found = expected.filter((n) => loaded.has(n));
      expect(found.length).toBeGreaterThan(0);
    });
  });
});
