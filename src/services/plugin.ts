// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited

import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { logger } from "./logger.js";

// ── Plugin interface ─────────────────────────────────────────────────────

type ProgressFn = (message: string) => void;

/**
 * The SocratiCode plugin interface.
 *
 * Plugins are auto-discovered from `src/plugins/<name>/index.ts`.
 * Each plugin self-registers by calling `pluginManager.register()`.
 */
export interface SocratiCodePlugin {
  name: string;
  onProjectIndexed?(projectPath: string, onProgress?: ProgressFn): Promise<void>;
  onProjectUpdated?(projectPath: string, onProgress?: ProgressFn): Promise<void>;
  onProjectRemoved?(projectPath: string): Promise<void>;
  onShutdown?(): Promise<void>;
}

// ── Plugin manager ───────────────────────────────────────────────────────

/**
 * Manages plugin discovery, registration, and lifecycle dispatch.
 *
 * Hook dispatch methods mirror the `SocratiCodePlugin` interface —
 * calling `pluginManager.onProjectIndexed()` fans out to every
 * registered plugin's `onProjectIndexed()`. All errors are non-fatal.
 */
export class PluginManager {
  private plugins: SocratiCodePlugin[] = [];
  private loaded = false;

  /** Register a plugin. Called by plugins at module load time. */
  register(plugin: SocratiCodePlugin): void {
    this.plugins.push(plugin);
    logger.info("Plugin registered", { plugin: plugin.name });
  }

  // ── Hook dispatch ────────────────────────────────────────────────

  /** Dispatch onProjectIndexed to all plugins. */
  async onProjectIndexed(projectPath: string, onProgress?: ProgressFn): Promise<void> {
    for (const plugin of this.plugins) {
      if (!plugin.onProjectIndexed) continue;
      try {
        await plugin.onProjectIndexed(projectPath, onProgress);
      } catch (err) {
        this.logFailure(plugin, "onProjectIndexed", projectPath, err);
        onProgress?.(`Plugin ${plugin.name} failed (non-fatal): ${this.errorMsg(err)}`);
      }
    }
  }

  /** Dispatch onProjectUpdated to all plugins. */
  async onProjectUpdated(projectPath: string, onProgress?: ProgressFn): Promise<void> {
    for (const plugin of this.plugins) {
      if (!plugin.onProjectUpdated) continue;
      try {
        await plugin.onProjectUpdated(projectPath, onProgress);
      } catch (err) {
        this.logFailure(plugin, "onProjectUpdated", projectPath, err);
        onProgress?.(`Plugin ${plugin.name} failed (non-fatal): ${this.errorMsg(err)}`);
      }
    }
  }

  /** Dispatch onProjectRemoved to all plugins. */
  async onProjectRemoved(projectPath: string): Promise<void> {
    for (const plugin of this.plugins) {
      if (!plugin.onProjectRemoved) continue;
      try {
        await plugin.onProjectRemoved(projectPath);
      } catch (err) {
        this.logFailure(plugin, "onProjectRemoved", projectPath, err);
      }
    }
  }

  /** Dispatch onShutdown to all plugins. */
  async onShutdown(): Promise<void> {
    for (const plugin of this.plugins) {
      if (!plugin.onShutdown) continue;
      try {
        await plugin.onShutdown();
      } catch (err) {
        logger.warn(`Plugin ${plugin.name}.onShutdown failed`, {
          plugin: plugin.name,
          error: this.errorMsg(err),
        });
      }
    }
  }

  // ── Discovery ────────────────────────────────────────────────────

  /**
   * Discover and load all plugins from `src/plugins/<name>/index.ts`.
   * Each plugin module calls `pluginManager.register()` on import.
   */
  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;

    const thisDir = dirname(fileURLToPath(import.meta.url));
    const pluginsDir = resolve(thisDir, "../plugins");

    let entries: string[];
    try {
      entries = readdirSync(pluginsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch {
      logger.info("No plugins directory found, skipping plugin discovery", { pluginsDir });
      return;
    }

    for (const name of entries) {
      const entryPath = join(pluginsDir, name, "index.js");
      try {
        await import(pathToFileURL(entryPath).href);
        logger.info("Plugin loaded", { plugin: name });
      } catch (err) {
        logger.warn("Plugin failed to load (skipping)", {
          plugin: name, entryPath, error: this.errorMsg(err),
        });
      }
    }
  }

  // ── Diagnostics ──────────────────────────────────────────────────

  get count(): number {
    return this.plugins.length;
  }

  get names(): string[] {
    return this.plugins.map((p) => p.name);
  }

  // ── Test helpers ─────────────────────────────────────────────────

  /** Clear all state. ONLY for use in tests. */
  _reset(): void {
    this.plugins.length = 0;
    this.loaded = false;
  }

  // ── Private ──────────────────────────────────────────────────────

  private errorMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }

  private logFailure(plugin: SocratiCodePlugin, hook: string, projectPath: string, err: unknown): void {
    logger.warn(`Plugin ${plugin.name}.${hook} failed (non-fatal)`, {
      plugin: plugin.name, hook, projectPath, error: this.errorMsg(err),
    });
  }
}

/** Singleton plugin manager instance. */
export const pluginManager = new PluginManager();
