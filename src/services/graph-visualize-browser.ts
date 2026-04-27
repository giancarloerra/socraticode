// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited

/**
 * Cross-platform helpers for the interactive graph viewer:
 *   1. Write a generated HTML document to a stable path inside the OS
 *      temp directory (one file per project, deterministic by projectId).
 *   2. Open that path in the user's default browser using the `open`
 *      package — handles macOS (`open`), Linux (`xdg-open`), and
 *      Windows (`start`) with zero external deps.
 *
 * `open` is called with `wait: false` so the call returns immediately;
 * on headless Linux systems where no browser is registered the function
 * swallows the error and lets the caller surface the path instead.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import open from "open";
import { logger } from "./logger.js";

/** Write HTML to a deterministic file under the OS temp dir. */
export async function writeInteractiveGraphFile(
  projectId: string,
  html: string,
): Promise<string> {
  const dir = path.join(os.tmpdir(), "socraticode-graph");
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${projectId}.html`);
  await fs.writeFile(file, html, "utf-8");
  logger.info("Wrote interactive graph HTML", { file, bytes: html.length });
  return file;
}

/** Open the given file path in the user's default browser (best-effort). */
export async function openInBrowser(filePath: string): Promise<{ opened: boolean; error?: string }> {
  try {
    await open(filePath, { wait: false });
    return { opened: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn("Failed to open browser — user can open manually", { filePath, error: message });
    return { opened: false, error: message };
  }
}
