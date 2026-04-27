// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited

import { describe, expect, it } from "vitest";
import { LRUCache, symbolIdToFile } from "../../src/services/symbol-graph-cache.js";

describe("LRUCache", () => {
  it("stores and retrieves values up to capacity", () => {
    const lru = new LRUCache<string, number>(3);
    lru.set("a", 1);
    lru.set("b", 2);
    lru.set("c", 3);
    expect(lru.get("a")).toBe(1);
    expect(lru.size).toBe(3);
  });

  it("evicts the oldest entry when over capacity", () => {
    const lru = new LRUCache<string, number>(2);
    lru.set("a", 1);
    lru.set("b", 2);
    lru.set("c", 3); // evicts "a"
    expect(lru.has("a")).toBe(false);
    expect(lru.has("b")).toBe(true);
    expect(lru.has("c")).toBe(true);
  });

  it("get() promotes a key to most-recently-used", () => {
    const lru = new LRUCache<string, number>(2);
    lru.set("a", 1);
    lru.set("b", 2);
    lru.get("a"); // a is now MRU
    lru.set("c", 3); // evicts b
    expect(lru.has("a")).toBe(true);
    expect(lru.has("b")).toBe(false);
    expect(lru.has("c")).toBe(true);
  });

  it("delete removes an entry", () => {
    const lru = new LRUCache<string, number>(2);
    lru.set("a", 1);
    expect(lru.delete("a")).toBe(true);
    expect(lru.has("a")).toBe(false);
    expect(lru.delete("missing")).toBe(false);
  });

  it("clear empties the cache", () => {
    const lru = new LRUCache<string, number>(2);
    lru.set("a", 1);
    lru.set("b", 2);
    lru.clear();
    expect(lru.size).toBe(0);
  });
});

describe("symbolIdToFile", () => {
  it("extracts file portion from a symbol id", () => {
    expect(symbolIdToFile("src/a.ts::foo#10")).toBe("src/a.ts");
    expect(symbolIdToFile("path/with/slashes/file.py::Foo.bar#42")).toBe("path/with/slashes/file.py");
  });

  it("returns null when separator missing", () => {
    expect(symbolIdToFile("malformed")).toBeNull();
  });
});
