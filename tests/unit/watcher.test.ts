// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited

import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────

// Track subscriptions created by @parcel/watcher mock
let mockSubscribeCallback: ((err: Error | null, events: Array<{ path: string; type: string }>) => void) | null = null;
const mockUnsubscribe = vi.fn(async () => {});

vi.mock("@parcel/watcher", () => ({
  default: {
    subscribe: vi.fn(async (_dir: string, cb: (err: Error | null, events: Array<{ path: string; type: string }>) => void, _opts?: unknown) => {
      mockSubscribeCallback = cb;
      return { unsubscribe: mockUnsubscribe };
    }),
  },
}));

vi.mock("../../src/services/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../src/services/ignore.js", () => ({
  createIgnoreFilter: vi.fn(() => ({ ignores: () => false })),
  shouldIgnore: vi.fn(() => false),
}));

const mockUpdateProjectIndex = vi.fn(async (_path: string, _progress?: unknown) => ({ added: 0, updated: 0, removed: 0, chunksCreated: 0, cancelled: false }));
const mockIsIndexingInProgress = vi.fn((_path: string) => false);
vi.mock("../../src/services/indexer.js", () => ({
  updateProjectIndex: (...args: unknown[]) => mockUpdateProjectIndex(...(args as [string, unknown])),
  isIndexingInProgress: (...args: unknown[]) => mockIsIndexingInProgress(...(args as [string])),
}));

vi.mock("../../src/services/code-graph.js", () => ({
  invalidateGraphCache: vi.fn(),
}));

const mockProjectIdFromPath = vi.fn((_p: string) => "test-project-id");
const mockCollectionName = vi.fn((_id: string) => "codebase_test");
vi.mock("../../src/config.js", () => ({
  projectIdFromPath: (...args: unknown[]) => mockProjectIdFromPath(...(args as [string])),
  collectionName: (...args: unknown[]) => mockCollectionName(...(args as [string])),
}));

const mockGetCollectionInfo = vi.fn(async (_c: string): Promise<{ pointsCount: number } | null> => null);
const mockGetProjectMetadata = vi.fn(async (_c: string): Promise<Record<string, unknown> | null> => null);
vi.mock("../../src/services/qdrant.js", () => ({
  getCollectionInfo: (...args: unknown[]) => mockGetCollectionInfo(...(args as [string])),
  getProjectMetadata: (...args: unknown[]) => mockGetProjectMetadata(...(args as [string])),
}));

const mockAcquireProjectLock = vi.fn(async (_path: string, _type: string) => true);
const mockReleaseProjectLock = vi.fn(async (_path: string, _type: string) => {});
const mockIsProjectLocked = vi.fn(async (_path: string, _type: string) => false);
vi.mock("../../src/services/lock.js", () => ({
  acquireProjectLock: (...args: unknown[]) => mockAcquireProjectLock(...(args as [string, string])),
  releaseProjectLock: (...args: unknown[]) => mockReleaseProjectLock(...(args as [string, string])),
  isProjectLocked: (...args: unknown[]) => mockIsProjectLocked(...(args as [string, string])),
}));

import { shouldIgnore } from "../../src/services/ignore.js";
import { logger } from "../../src/services/logger.js";
// Import after mocks
import {
  clearExternalWatchCache,
  ensureWatcherStarted,
  getWatchedProjects,
  isWatchedByAnyProcess,
  isWatching,
  startWatching,
  stopAllWatchers,
  stopWatching,
} from "../../src/services/watcher.js";

// ── Helpers ──────────────────────────────────────────────────────────────

const TEST_PROJECT = "/tmp/test-project";
const RESOLVED_PROJECT = path.resolve(TEST_PROJECT);

// ── Tests ────────────────────────────────────────────────────────────────

describe("watcher (unit)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSubscribeCallback = null;
    mockAcquireProjectLock.mockResolvedValue(true);
    mockIsProjectLocked.mockResolvedValue(false);
    mockIsIndexingInProgress.mockReturnValue(false);
    mockGetCollectionInfo.mockResolvedValue(null);
    mockGetProjectMetadata.mockResolvedValue(null);
  });

  afterEach(async () => {
    // Clean up any active watchers between tests
    await stopAllWatchers();
    clearExternalWatchCache();
  });

  // ── startWatching / stopWatching / isWatching / getWatchedProjects ───

  describe("startWatching", () => {
    it("starts watching and reports via onProgress", async () => {
      const progress: string[] = [];
      const result = await startWatching(TEST_PROJECT, (msg) => progress.push(msg));

      expect(result).toBe(true);
      expect(isWatching(TEST_PROJECT)).toBe(true);
      expect(progress).toContain(`Started watching ${RESOLVED_PROJECT}`);
      expect(logger.info).toHaveBeenCalledWith("File watcher started", { projectPath: RESOLVED_PROJECT });
    });

    it("acquires a cross-process lock", async () => {
      await startWatching(TEST_PROJECT);
      expect(mockAcquireProjectLock).toHaveBeenCalledWith(RESOLVED_PROJECT, "watch");
    });

    it("skips if already watching (idempotent)", async () => {
      const progress: string[] = [];
      await startWatching(TEST_PROJECT);
      const result = await startWatching(TEST_PROJECT, (msg) => progress.push(msg));

      expect(result).toBe(true);
      expect(progress).toContain(`Already watching ${RESOLVED_PROJECT}`);
      // subscribe should only be called once
      const watcher = await import("@parcel/watcher");
      expect(watcher.default.subscribe).toHaveBeenCalledTimes(1);
    });

    it("skips if lock cannot be acquired (another process watching)", async () => {
      mockAcquireProjectLock.mockResolvedValue(false);
      const progress: string[] = [];
      const result = await startWatching(TEST_PROJECT, (msg) => progress.push(msg));

      expect(result).toBe(false);
      expect(isWatching(TEST_PROJECT)).toBe(false);
      expect(progress.some((m) => m.includes("Another process"))).toBe(true);
    });

    it("releases lock if @parcel/watcher.subscribe fails", async () => {
      const watcher = await import("@parcel/watcher");
      vi.mocked(watcher.default.subscribe).mockRejectedValueOnce(new Error("Permission denied"));

      const progress: string[] = [];
      const result = await startWatching(TEST_PROJECT, (msg) => progress.push(msg));

      expect(result).toBe(false);
      expect(isWatching(TEST_PROJECT)).toBe(false);
      expect(mockReleaseProjectLock).toHaveBeenCalledWith(RESOLVED_PROJECT, "watch");
      expect(progress.some((m) => m.includes("Failed to start watching"))).toBe(true);
    });
  });

  describe("stopWatching", () => {
    it("stops an active watcher and releases lock", async () => {
      await startWatching(TEST_PROJECT);
      expect(isWatching(TEST_PROJECT)).toBe(true);

      await stopWatching(TEST_PROJECT);
      expect(isWatching(TEST_PROJECT)).toBe(false);
      expect(mockUnsubscribe).toHaveBeenCalled();
      expect(mockReleaseProjectLock).toHaveBeenCalledWith(RESOLVED_PROJECT, "watch");
    });

    it("does nothing for a non-watched project", async () => {
      await expect(stopWatching("/nonexistent")).resolves.not.toThrow();
      expect(mockUnsubscribe).not.toHaveBeenCalled();
    });
  });

  describe("stopAllWatchers", () => {
    it("stops all active watchers", async () => {
      await startWatching(TEST_PROJECT);
      expect(getWatchedProjects().length).toBe(1);

      await stopAllWatchers();
      expect(getWatchedProjects()).toHaveLength(0);
    });
  });

  describe("isWatching", () => {
    it("returns false when not watching", () => {
      expect(isWatching(TEST_PROJECT)).toBe(false);
    });

    it("returns true when watching", async () => {
      await startWatching(TEST_PROJECT);
      expect(isWatching(TEST_PROJECT)).toBe(true);
    });

    it("resolves relative paths", async () => {
      await startWatching(TEST_PROJECT);
      // Should match regardless of trailing slashes etc via path.resolve
      expect(isWatching(TEST_PROJECT)).toBe(true);
    });
  });

  describe("getWatchedProjects", () => {
    it("returns empty array when nothing is watched", () => {
      expect(getWatchedProjects()).toEqual([]);
    });

    it("returns resolved paths of watched projects", async () => {
      await startWatching(TEST_PROJECT);
      const projects = getWatchedProjects();
      expect(projects).toHaveLength(1);
      expect(projects[0]).toBe(RESOLVED_PROJECT);
    });
  });

  // ── isWatchedByAnyProcess (cross-process awareness) ────────────────

  describe("isWatchedByAnyProcess", () => {
    it("returns true when watching locally", async () => {
      await startWatching(TEST_PROJECT);
      expect(await isWatchedByAnyProcess(TEST_PROJECT)).toBe(true);
    });

    it("returns true when another process holds the watch lock", async () => {
      mockIsProjectLocked.mockResolvedValue(true);
      expect(await isWatchedByAnyProcess(TEST_PROJECT)).toBe(true);
      expect(mockIsProjectLocked).toHaveBeenCalledWith(RESOLVED_PROJECT, "watch");
    });

    it("returns false when not watched locally and no lock held", async () => {
      mockIsProjectLocked.mockResolvedValue(false);
      expect(await isWatchedByAnyProcess(TEST_PROJECT)).toBe(false);
    });

    it("skips lock check when watching locally (fast path)", async () => {
      await startWatching(TEST_PROJECT);
      mockIsProjectLocked.mockClear();
      expect(await isWatchedByAnyProcess(TEST_PROJECT)).toBe(true);
      expect(mockIsProjectLocked).not.toHaveBeenCalled();
    });
  });

  // ── Event filtering (via the callback) ─────────────────────────────────

  describe("event filtering", () => {
    it("triggers update for indexable file changes", async () => {
      vi.useFakeTimers();
      const progress = vi.fn();
      await startWatching(TEST_PROJECT, progress);

      // Simulate a file change event
      mockSubscribeCallback?.(null, [
        { path: path.join(RESOLVED_PROJECT, "src/app.ts"), type: "update" },
      ]);

      // Fast-forward past the debounce
      await vi.advanceTimersByTimeAsync(2100);

      expect(mockUpdateProjectIndex).toHaveBeenCalledWith(RESOLVED_PROJECT, progress);
      vi.useRealTimers();
    });

    it("ignores non-indexable files (e.g. .png, .lock)", async () => {
      vi.useFakeTimers();
      await startWatching(TEST_PROJECT);

      mockSubscribeCallback?.(null, [
        { path: path.join(RESOLVED_PROJECT, "image.png"), type: "create" },
        { path: path.join(RESOLVED_PROJECT, "package-lock.json"), type: "update" },
      ]);

      // .png is not in SUPPORTED_EXTENSIONS and not in SPECIAL_FILES
      // .json IS supported, so this actually triggers — but .png is filtered

      await vi.advanceTimersByTimeAsync(2100);

      // package-lock.json has .json extension which IS in SUPPORTED_EXTENSIONS,
      // so the update should still trigger for that event
      expect(mockUpdateProjectIndex).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });

    it("ignores files that match gitignore rules", async () => {
      vi.useFakeTimers();
      vi.mocked(shouldIgnore).mockReturnValue(true);

      await startWatching(TEST_PROJECT);

      mockSubscribeCallback?.(null, [
        { path: path.join(RESOLVED_PROJECT, "dist/bundle.js"), type: "create" },
      ]);

      await vi.advanceTimersByTimeAsync(2100);

      // All events were filtered by shouldIgnore, so no update
      expect(mockUpdateProjectIndex).not.toHaveBeenCalled();
      vi.useRealTimers();
    });

    it("ignores files outside the project tree", async () => {
      vi.useFakeTimers();
      vi.mocked(shouldIgnore).mockReturnValue(false);

      await startWatching(TEST_PROJECT);

      mockSubscribeCallback?.(null, [
        { path: "/some/other/project/file.ts", type: "update" },
      ]);

      await vi.advanceTimersByTimeAsync(2100);

      expect(mockUpdateProjectIndex).not.toHaveBeenCalled();
      vi.useRealTimers();
    });

    it("handles special files (Dockerfile, Makefile)", async () => {
      vi.useFakeTimers();
      vi.mocked(shouldIgnore).mockReturnValue(false);

      await startWatching(TEST_PROJECT);

      mockSubscribeCallback?.(null, [
        { path: path.join(RESOLVED_PROJECT, "Dockerfile"), type: "update" },
      ]);

      await vi.advanceTimersByTimeAsync(2100);

      expect(mockUpdateProjectIndex).toHaveBeenCalled();
      vi.useRealTimers();
    });
  });

  // ── Debounce behavior ──────────────────────────────────────────────────

  describe("debounce", () => {
    it("coalesces rapid changes into a single update", async () => {
      vi.useFakeTimers();
      vi.mocked(shouldIgnore).mockReturnValue(false);

      await startWatching(TEST_PROJECT);

      // Fire 5 rapid events
      for (let i = 0; i < 5; i++) {
        mockSubscribeCallback?.(null, [
          { path: path.join(RESOLVED_PROJECT, `file${i}.ts`), type: "update" },
        ]);
      }

      await vi.advanceTimersByTimeAsync(2100);

      // Only one update call despite 5 events
      expect(mockUpdateProjectIndex).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });

    it("does not trigger update before debounce period", async () => {
      vi.useFakeTimers();
      vi.mocked(shouldIgnore).mockReturnValue(false);

      await startWatching(TEST_PROJECT);

      mockSubscribeCallback?.(null, [
        { path: path.join(RESOLVED_PROJECT, "file.ts"), type: "update" },
      ]);

      // Only 1 second has passed — should not have triggered yet
      await vi.advanceTimersByTimeAsync(1000);
      expect(mockUpdateProjectIndex).not.toHaveBeenCalled();

      // Now pass the debounce threshold
      await vi.advanceTimersByTimeAsync(1100);
      expect(mockUpdateProjectIndex).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });
  });

  // ── Error handling ─────────────────────────────────────────────────────

  describe("error handling", () => {
    it("logs first 3 errors", async () => {
      await startWatching(TEST_PROJECT);

      for (let i = 0; i < 3; i++) {
        mockSubscribeCallback?.(new Error(`test error ${i}`), []);
      }

      expect(logger.error).toHaveBeenCalledTimes(3);
    });

    it("throttles error logging after 3rd error (logs every 100th)", async () => {
      await startWatching(TEST_PROJECT);

      // Fire 10 errors (below MAX_WATCHER_ERRORS threshold for this test — it will auto-stop at 10)
      // But we need to test throttling, so let's fire 4 to see the 4th is suppressed
      for (let i = 0; i < 4; i++) {
        mockSubscribeCallback?.(new Error(`error ${i}`), []);
      }

      // First 3 errors + the "too many errors" is NOT triggered yet (count=4 < 10)
      // logger.error is called for errors 1, 2, 3 but NOT 4
      const errorCalls = vi.mocked(logger.error).mock.calls.filter(
        (call) => call[0] === "File watcher error",
      );
      expect(errorCalls).toHaveLength(3);
    });

    it("auto-stops watcher after MAX_WATCHER_ERRORS consecutive errors", async () => {
      await startWatching(TEST_PROJECT);
      expect(isWatching(TEST_PROJECT)).toBe(true);

      // Fire 10 consecutive errors
      for (let i = 0; i < 10; i++) {
        mockSubscribeCallback?.(new Error(`error ${i}`), []);
      }

      // The auto-stop is asynchronous, so wait for it
      await vi.waitFor(() => {
        expect(isWatching(TEST_PROJECT)).toBe(false);
      });

      expect(logger.error).toHaveBeenCalledWith(
        "Too many watcher errors, stopping watcher",
        expect.objectContaining({ totalErrors: 10 }),
      );
    });

    it("resets error count on successful event delivery", async () => {
      vi.useFakeTimers();
      vi.mocked(shouldIgnore).mockReturnValue(false);
      await startWatching(TEST_PROJECT);

      // Fire 5 errors
      for (let i = 0; i < 5; i++) {
        mockSubscribeCallback?.(new Error(`error ${i}`), []);
      }

      // Then a successful event — error count should reset
      mockSubscribeCallback?.(null, [
        { path: path.join(RESOLVED_PROJECT, "file.ts"), type: "update" },
      ]);

      // Fire 5 more errors — should NOT auto-stop (count restarted from 0)
      for (let i = 0; i < 5; i++) {
        mockSubscribeCallback?.(new Error(`error ${i}`), []);
      }

      // Should still be watching (5 + 0 + 5, but count was reset in the middle)
      expect(isWatching(TEST_PROJECT)).toBe(true);
      vi.useRealTimers();
    });
  });

  // ── ensureWatcherStarted ───────────────────────────────────────────────

  describe("ensureWatcherStarted", () => {
    it("does nothing if already watching", async () => {
      await startWatching(TEST_PROJECT);
      mockGetCollectionInfo.mockClear();

      ensureWatcherStarted(TEST_PROJECT);

      // Should not even check collection info
      expect(mockGetCollectionInfo).not.toHaveBeenCalled();
    });

    it("does nothing if indexing is in progress", () => {
      mockIsIndexingInProgress.mockReturnValue(true);

      ensureWatcherStarted(TEST_PROJECT);

      expect(mockGetCollectionInfo).not.toHaveBeenCalled();
    });

    it("does nothing if no collection exists", async () => {
      mockGetCollectionInfo.mockResolvedValue(null);

      ensureWatcherStarted(TEST_PROJECT);

      // Wait for the async chain to complete
      await vi.waitFor(() => {
        expect(mockGetCollectionInfo).toHaveBeenCalled();
      });

      // Should not have started watching
      expect(isWatching(TEST_PROJECT)).toBe(false);
    });

    it("does nothing if collection is empty (0 points)", async () => {
      mockGetCollectionInfo.mockResolvedValue({ pointsCount: 0 });

      ensureWatcherStarted(TEST_PROJECT);

      await vi.waitFor(() => {
        expect(mockGetCollectionInfo).toHaveBeenCalled();
      });

      expect(isWatching(TEST_PROJECT)).toBe(false);
    });

    it("does not start if indexing status is not completed", async () => {
      mockGetCollectionInfo.mockResolvedValue({ pointsCount: 100 });
      mockGetProjectMetadata.mockResolvedValue({
        indexingStatus: "in-progress",
        filesIndexed: 10,
        filesTotal: 50,
      });

      ensureWatcherStarted(TEST_PROJECT);

      await vi.waitFor(() => {
        expect(mockGetProjectMetadata).toHaveBeenCalled();
      });

      // Give the async chain a moment to complete
      await new Promise((r) => setTimeout(r, 50));

      expect(isWatching(TEST_PROJECT)).toBe(false);
      expect(logger.info).toHaveBeenCalledWith(
        "Skipping watcher auto-start: index is incomplete (interrupted)",
        expect.objectContaining({ indexingStatus: "in-progress" }),
      );
    });

    it("starts watcher when collection exists and index is completed", async () => {
      mockGetCollectionInfo.mockResolvedValue({ pointsCount: 100 });
      mockGetProjectMetadata.mockResolvedValue({ indexingStatus: "completed" });

      ensureWatcherStarted(TEST_PROJECT);

      await vi.waitFor(() => {
        expect(isWatching(TEST_PROJECT)).toBe(true);
      });

      expect(logger.info).toHaveBeenCalledWith(
        "Auto-started file watcher on tool use",
        expect.objectContaining({ projectPath: RESOLVED_PROJECT }),
      );
    });

    it("starts watcher when metadata is null (legacy — no metadata point)", async () => {
      // Older indexed projects may not have a metadata point at all
      mockGetCollectionInfo.mockResolvedValue({ pointsCount: 100 });
      mockGetProjectMetadata.mockResolvedValue(null);

      ensureWatcherStarted(TEST_PROJECT);

      await vi.waitFor(() => {
        expect(isWatching(TEST_PROJECT)).toBe(true);
      });
    });

    it("handles errors gracefully (non-fatal)", async () => {
      mockGetCollectionInfo.mockRejectedValue(new Error("Qdrant unreachable"));

      ensureWatcherStarted(TEST_PROJECT);

      await vi.waitFor(() => {
        expect(logger.debug).toHaveBeenCalledWith(
          "Auto-start watcher check failed (non-fatal)",
          expect.objectContaining({ error: "Qdrant unreachable" }),
        );
      });

      expect(isWatching(TEST_PROJECT)).toBe(false);
    });

    it("caches external watch and skips retry within TTL", async () => {
      // Simulate another process holding the watch lock
      mockAcquireProjectLock.mockResolvedValue(false);
      mockGetCollectionInfo.mockResolvedValue({ pointsCount: 100 });
      mockGetProjectMetadata.mockResolvedValue({ indexingStatus: "completed" });

      ensureWatcherStarted(TEST_PROJECT);

      // Wait for the async chain to complete and cache the external watch
      await vi.waitFor(() => {
        expect(mockAcquireProjectLock).toHaveBeenCalled();
      });
      await new Promise((r) => setTimeout(r, 50));

      // Clear mocks to track subsequent calls
      mockGetCollectionInfo.mockClear();
      mockAcquireProjectLock.mockClear();

      // Call again — should be cached, no collection check or lock attempt
      ensureWatcherStarted(TEST_PROJECT);
      await new Promise((r) => setTimeout(r, 50));

      expect(mockGetCollectionInfo).not.toHaveBeenCalled();
    });

    it("does not log 'Auto-started' when another process holds the lock", async () => {
      mockAcquireProjectLock.mockResolvedValue(false);
      mockGetCollectionInfo.mockResolvedValue({ pointsCount: 100 });
      mockGetProjectMetadata.mockResolvedValue({ indexingStatus: "completed" });

      ensureWatcherStarted(TEST_PROJECT);

      await vi.waitFor(() => {
        expect(mockAcquireProjectLock).toHaveBeenCalled();
      });
      await new Promise((r) => setTimeout(r, 50));

      // Should log that another process is watching, NOT that we auto-started
      expect(logger.info).toHaveBeenCalledWith(
        "Another process is already watching this project, skipping",
        expect.anything(),
      );
      expect(logger.info).not.toHaveBeenCalledWith(
        "Auto-started file watcher on tool use",
        expect.anything(),
      );
    });

    it("re-checks conditions after async gap", async () => {
      mockGetCollectionInfo.mockResolvedValue({ pointsCount: 100 });
      mockGetProjectMetadata.mockResolvedValue({ indexingStatus: "completed" });

      // Start watching before ensureWatcherStarted's async chain completes
      await startWatching(TEST_PROJECT);

      const watcher = await import("@parcel/watcher");
      const subscribeCallCount = vi.mocked(watcher.default.subscribe).mock.calls.length;

      ensureWatcherStarted(TEST_PROJECT);

      // Wait for the async chain
      await new Promise((r) => setTimeout(r, 50));

      // subscribe should NOT have been called again (re-check detected already watching)
      expect(vi.mocked(watcher.default.subscribe).mock.calls.length).toBe(subscribeCallCount);
    });
  });

  // ── Graceful degradation ───────────────────────────────────────────────

  describe("graceful degradation on update failure", () => {
    it("logs error but keeps watcher running when update fails", async () => {
      vi.useFakeTimers();
      vi.mocked(shouldIgnore).mockReturnValue(false);
      mockUpdateProjectIndex.mockRejectedValueOnce(new Error("Something failed"));

      await startWatching(TEST_PROJECT);

      mockSubscribeCallback?.(null, [
        { path: path.join(RESOLVED_PROJECT, "file.ts"), type: "update" },
      ]);

      await vi.advanceTimersByTimeAsync(2100);

      expect(logger.error).toHaveBeenCalledWith(
        "Watch auto-update failed",
        expect.objectContaining({ error: "Something failed" }),
      );
      // Watcher should still be running
      expect(isWatching(TEST_PROJECT)).toBe(true);
      vi.useRealTimers();
    });
  });
});
