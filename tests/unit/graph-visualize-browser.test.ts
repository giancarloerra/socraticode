// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("open", () => ({ default: vi.fn().mockResolvedValue(undefined) }));

import openMock from "open";
import { openInBrowser, writeInteractiveGraphFile } from "../../src/services/graph-visualize-browser.js";

describe("writeInteractiveGraphFile", () => {
  const written: string[] = [];
  afterEach(async () => {
    for (const f of written.splice(0)) await fs.rm(f, { force: true });
  });

  it("writes to a deterministic path keyed by projectId", async () => {
    const html = "<!doctype html><html></html>";
    const p1 = await writeInteractiveGraphFile("proj-abc", html);
    written.push(p1);
    expect(p1).toBe(path.join(os.tmpdir(), "socraticode-graph", "proj-abc.html"));
    const read = await fs.readFile(p1, "utf-8");
    expect(read).toBe(html);
  });

  it("overwrites on a second call for the same project", async () => {
    const a = await writeInteractiveGraphFile("proj-overwrite", "<html>v1</html>");
    written.push(a);
    const b = await writeInteractiveGraphFile("proj-overwrite", "<html>v2</html>");
    expect(a).toBe(b);
    const read = await fs.readFile(b, "utf-8");
    expect(read).toBe("<html>v2</html>");
  });
});

describe("openInBrowser", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns opened:true when the `open` package succeeds", async () => {
    vi.mocked(openMock).mockResolvedValueOnce(undefined as unknown as never);
    const result = await openInBrowser("/tmp/x.html");
    expect(result.opened).toBe(true);
    expect(openMock).toHaveBeenCalledWith("/tmp/x.html", { wait: false });
  });

  it("returns opened:false + error on failure (headless env, blocked, etc.)", async () => {
    vi.mocked(openMock).mockRejectedValueOnce(new Error("xdg-open missing"));
    const result = await openInBrowser("/tmp/x.html");
    expect(result.opened).toBe(false);
    expect(result.error).toContain("xdg-open");
  });
});
