// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from "vitest";
import { pluginManager } from "../../src/services/plugin.js";

// Suppress logger output during tests
vi.mock("../../src/services/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("PluginManager", () => {
  afterEach(() => {
    pluginManager._reset();
  });

  // ── Registration ───────────────────────────────────────────────────

  describe("register", () => {
    it("registers a plugin", () => {
      pluginManager.register({ name: "test-plugin" });
      expect(pluginManager.count).toBe(1);
      expect(pluginManager.names).toEqual(["test-plugin"]);
    });

    it("registers multiple plugins", () => {
      pluginManager.register({ name: "alpha" });
      pluginManager.register({ name: "beta" });
      expect(pluginManager.count).toBe(2);
      expect(pluginManager.names).toEqual(["alpha", "beta"]);
    });
  });

  // ── Hook dispatch ──────────────────────────────────────────────────

  describe("onProjectIndexed", () => {
    it("calls onProjectIndexed on all plugins that implement it", async () => {
      const onIndexed = vi.fn();
      pluginManager.register({ name: "a", onProjectIndexed: onIndexed });
      pluginManager.register({ name: "b" });

      await pluginManager.onProjectIndexed("/test/path");

      expect(onIndexed).toHaveBeenCalledOnce();
      expect(onIndexed).toHaveBeenCalledWith("/test/path", undefined);
    });

    it("calls hooks in registration order", async () => {
      const order: string[] = [];
      pluginManager.register({
        name: "first",
        onProjectIndexed: async () => { order.push("first"); },
      });
      pluginManager.register({
        name: "second",
        onProjectIndexed: async () => { order.push("second"); },
      });

      await pluginManager.onProjectIndexed("/test");
      expect(order).toEqual(["first", "second"]);
    });

    it("does not stop on plugin errors (non-fatal)", async () => {
      const order: string[] = [];
      pluginManager.register({
        name: "crasher",
        onProjectIndexed: async () => { throw new Error("boom"); },
      });
      pluginManager.register({
        name: "survivor",
        onProjectIndexed: async () => { order.push("survivor"); },
      });

      await pluginManager.onProjectIndexed("/test");
      expect(order).toEqual(["survivor"]);
    });
  });

  describe("onProjectUpdated", () => {
    it("passes onProgress to hooks", async () => {
      const onUpdated = vi.fn();
      const progress = vi.fn();
      pluginManager.register({ name: "a", onProjectUpdated: onUpdated });

      await pluginManager.onProjectUpdated("/test", progress);

      expect(onUpdated).toHaveBeenCalledWith("/test", progress);
    });
  });

  describe("onProjectRemoved", () => {
    it("calls onProjectRemoved without onProgress", async () => {
      const onRemoved = vi.fn();
      pluginManager.register({ name: "a", onProjectRemoved: onRemoved });

      await pluginManager.onProjectRemoved("/test");

      expect(onRemoved).toHaveBeenCalledWith("/test");
    });
  });

  // ── Shutdown ───────────────────────────────────────────────────────

  describe("onShutdown", () => {
    it("calls onShutdown on all plugins", async () => {
      const shutdown1 = vi.fn();
      const shutdown2 = vi.fn();
      pluginManager.register({ name: "a", onShutdown: shutdown1 });
      pluginManager.register({ name: "b", onShutdown: shutdown2 });

      await pluginManager.onShutdown();

      expect(shutdown1).toHaveBeenCalledOnce();
      expect(shutdown2).toHaveBeenCalledOnce();
    });

    it("continues if a plugin shutdown fails", async () => {
      const shutdown2 = vi.fn();
      pluginManager.register({
        name: "crasher",
        onShutdown: async () => { throw new Error("oops"); },
      });
      pluginManager.register({ name: "ok", onShutdown: shutdown2 });

      await pluginManager.onShutdown();

      expect(shutdown2).toHaveBeenCalledOnce();
    });
  });

  // ── _reset ─────────────────────────────────────────────────────────

  describe("_reset", () => {
    it("removes all registered plugins", () => {
      pluginManager.register({ name: "a" });
      pluginManager.register({ name: "b" });
      expect(pluginManager.count).toBe(2);

      pluginManager._reset();
      expect(pluginManager.count).toBe(0);
    });
  });
});
