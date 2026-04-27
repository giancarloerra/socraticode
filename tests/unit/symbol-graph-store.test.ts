// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited

import { describe, expect, it } from "vitest";
import { SYMBOL_REVERSE_SHARDS } from "../../src/constants.js";
import {
  allNameShardKeys,
  contentHashOf,
  nameShardKey,
  reverseShardHex,
  reverseShardKey,
} from "../../src/services/symbol-graph-store.js";

describe("symbol-graph-store: shard helpers", () => {
  describe("nameShardKey", () => {
    it("maps lowercase ascii letters to themselves", () => {
      for (const c of "abcdefghijklmnopqrstuvwxyz") {
        expect(nameShardKey(`${c}foo`)).toBe(c);
      }
    });

    it("normalises uppercase to lowercase", () => {
      expect(nameShardKey("Foo")).toBe("f");
      expect(nameShardKey("ZZZ")).toBe("z");
    });

    it("returns underscore for non-letter starts", () => {
      expect(nameShardKey("_private")).toBe("_");
      expect(nameShardKey("0digit")).toBe("_");
      expect(nameShardKey("$dollar")).toBe("_");
    });

    it("returns underscore for empty string", () => {
      expect(nameShardKey("")).toBe("_");
    });
  });

  describe("allNameShardKeys", () => {
    it("returns exactly 27 keys (a-z plus underscore)", () => {
      const keys = allNameShardKeys();
      expect(keys).toHaveLength(27);
      expect(keys[0]).toBe("_");
      for (let i = 0; i < 26; i++) {
        expect(keys[i + 1]).toBe(String.fromCharCode("a".charCodeAt(0) + i));
      }
    });

    it("returns a stable order across calls", () => {
      const a = allNameShardKeys();
      const b = allNameShardKeys();
      expect(a).toEqual(b);
    });
  });

  describe("reverseShardKey", () => {
    it("returns a number in [0, SYMBOL_REVERSE_SHARDS)", () => {
      for (const f of [
        "src/foo.ts",
        "lib/bar.py",
        "index.go",
        "very/deeply/nested/path/file.rs",
        "",
      ]) {
        const k = reverseShardKey(f);
        expect(k).toBeGreaterThanOrEqual(0);
        expect(k).toBeLessThan(SYMBOL_REVERSE_SHARDS);
      }
    });

    it("is deterministic for the same input", () => {
      expect(reverseShardKey("src/a.ts")).toBe(reverseShardKey("src/a.ts"));
    });

    it("distributes 1k synthetic paths reasonably across buckets", () => {
      const buckets = new Set<number>();
      for (let i = 0; i < 1000; i++) {
        buckets.add(reverseShardKey(`src/file-${i}.ts`));
      }
      // With 256 buckets and 1000 hashes, we expect well over 100 distinct buckets.
      expect(buckets.size).toBeGreaterThan(100);
    });
  });

  describe("reverseShardHex", () => {
    it("zero-pads to two hex characters", () => {
      expect(reverseShardHex(0)).toBe("00");
      expect(reverseShardHex(1)).toBe("01");
      expect(reverseShardHex(15)).toBe("0f");
      expect(reverseShardHex(255)).toBe("ff");
    });

    it("matches reverseShardKey output width for all 256 buckets", () => {
      for (let i = 0; i < SYMBOL_REVERSE_SHARDS; i++) {
        const hex = reverseShardHex(i);
        expect(hex).toMatch(/^[0-9a-f]{2}$/);
      }
    });
  });

  describe("contentHashOf", () => {
    it("returns a 64-character hex string for SHA-256", () => {
      const h = contentHashOf("hello world");
      expect(h).toMatch(/^[0-9a-f]{64}$/);
    });

    it("differs for different content", () => {
      expect(contentHashOf("a")).not.toBe(contentHashOf("b"));
    });

    it("matches the well-known SHA-256 of a fixed string", () => {
      // SHA-256("hello") = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
      expect(contentHashOf("hello")).toBe(
        "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
      );
    });
  });
});
