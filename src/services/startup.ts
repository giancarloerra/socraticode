// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited

/**
 * Startup lifecycle helpers — auto-resume and graceful shutdown coordination.
 *
 * Extracted from src/index.ts so the logic can be unit-tested independently
 * of the MCP stdio transport.
 */

import { collectionName, projectIdFromPath } from "../config.js";
import { QDRANT_MODE } from "../constants.js";
import { isDockerAvailable, isQdrantRunning } from "./docker.js";
import { pluginManager } from "./plugin.js";
import { getIndexingInProgressProjects, getPersistedIndexingStatus, indexProject, requestCancellation, updateProjectIndex } from "./indexer.js";
import { getLockHolderPid, releaseAllLocks } from "./lock.js";
import { logger } from "./logger.js";
import { listCodebaseCollections } from "./qdrant.js";
import { isWatching, startWatching, stopAllWatchers } from "./watcher.js";

/**
 * Auto-resume for the current project (process.cwd()) on server startup.
 *
 * If the project has a completed index:
 *   - Start file watcher
 *   - Run incremental update to catch changes made while the MCP was down
 *
 * If the project has an incomplete (interrupted) index:
 *   - Run indexProject which skips already-hashed files and embeds the rest,
 *     correctly resuming the full index (supports codebase_stop cancellation)
 *   - Watcher starts automatically after indexProject completes
 *
 * Runs in the background after server startup — non-blocking, non-fatal.
 *
 * @param projectPath - Override project path (defaults to process.cwd()).
 *   Only used by tests — production always uses process.cwd().
 */
export async function autoResumeIndexedProjects(projectPath?: string): Promise<void> {
  try {
    // Discover and load plugins from src/plugins/*/index.ts
    await pluginManager.load();
    
    // In managed mode, check if Docker and Qdrant are already running — don't start them.
    // In external mode, skip Docker checks and let listCodebaseCollections() fail if unreachable.
    if (QDRANT_MODE === "managed") {
      if (!(await isDockerAvailable())) {
        logger.info("Auto-resume: Docker not available, skipping");
        return;
      }
      if (!(await isQdrantRunning())) {
        logger.info("Auto-resume: Qdrant not running, skipping");
        return;
      }
    }

    // Only consider the current project
    const resolvedPath = projectPath ?? process.cwd();

    // If CWD is root or home, the MCP host hasn't opened a specific project yet — skip
    if (resolvedPath === "/" || resolvedPath === process.env.HOME) {
      logger.info("Auto-resume: CWD is root/home, no specific project — skipping", { projectPath: resolvedPath });
      return;
    }

    const projectId = projectIdFromPath(resolvedPath);
    const collection = collectionName(projectId);

    const collections = await listCodebaseCollections();
    if (!collections.includes(collection)) {
      logger.info("Auto-resume: current project not yet indexed, skipping", { projectPath: resolvedPath });
      return;
    }

    // Check persisted indexing status to detect interrupted indexing
    const persistedStatus = await getPersistedIndexingStatus(resolvedPath);

    if (persistedStatus === "in-progress") {
      // Check if another process is already indexing (orphan from previous session)
      const orphanPid = await getLockHolderPid(resolvedPath, "index");
      if (orphanPid !== null) {
        logger.info("Auto-resume: skipping — another process is still indexing this project", {
          projectPath: resolvedPath, orphanPid,
        });
        return;
      }

      // Index was interrupted — resume it via indexProject.
      // indexProject skips already-hashed files, embeds the rest, and honours
      // codebase_stop cancellation requests (unlike updateProjectIndex's incremental diff).
      // Do NOT start watcher yet — it will start after indexing completes.
      logger.info("Auto-resume: detected incomplete index, resuming indexing", { projectPath: resolvedPath });
      const resumeOnProgress = (msg: string) => logger.info(msg, { tool: "auto-resume", projectPath: resolvedPath });
      indexProject(resolvedPath, resumeOnProgress)
        .then(async (result) => {
          logger.info("Auto-resume: incomplete index recovery completed", {
            projectPath: resolvedPath,
            filesIndexed: result.filesIndexed,
            chunksCreated: result.chunksCreated,
            cancelled: result.cancelled,
          });
          // Now start the watcher after recovery — only if not cancelled
          if (!result.cancelled && !isWatching(resolvedPath)) {
            const started = await startWatching(resolvedPath);
            if (started) {
              logger.info("Auto-resume: started file watcher after recovery", { projectPath: resolvedPath });
            }
          }
        })
        .catch((err) => {
          logger.warn("Auto-resume: incomplete index recovery failed (non-fatal)", {
            projectPath: resolvedPath,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      return;
    }

    // Index is complete — start watcher and do incremental catch-up
    if (!isWatching(resolvedPath)) {
      const started = await startWatching(resolvedPath);
      if (started) {
        logger.info("Auto-resume: started file watcher", { projectPath: resolvedPath });
      }
    }

    // Incremental update in the background — only re-embeds actually changed files
    // Note: updateProjectIndex now handles code graph rebuild internally
    updateProjectIndex(resolvedPath)
      .then(async (result) => {
        const changed = result.added + result.updated + result.removed;
        if (changed > 0) {
          logger.info("Auto-resume: incremental update completed", {
            projectPath: resolvedPath,
            added: result.added,
            updated: result.updated,
            removed: result.removed,
            filesChanged: changed,
          });
        } else {
          logger.info("Auto-resume: index is up to date", { projectPath: resolvedPath });
        }
      })
      .catch((err) => {
        logger.warn("Auto-resume: incremental update failed (non-fatal)", {
          projectPath: resolvedPath,
          error: err instanceof Error ? err.message : String(err),
        });
      });
  } catch (err) {
    logger.warn("Auto-resume failed (non-fatal)", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Wait for any active indexing operations to complete (with timeout). */
export async function awaitActiveIndexing(timeoutMs = 60_000): Promise<void> {
  const active = getIndexingInProgressProjects();
  if (active.length === 0) return;

  logger.info("Waiting for active indexing to complete before shutdown", {
    projects: active,
  });

  const deadline = Date.now() + timeoutMs;
  while (getIndexingInProgressProjects().length > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
  }

  const remaining = getIndexingInProgressProjects();
  if (remaining.length > 0) {
    logger.warn("Forcing shutdown — indexing still in progress. Progress is checkpointed; it will resume with no data loss.", {
      projects: remaining,
    });
  }
}

/**
 * Execute graceful shutdown: cancel in-flight indexing, wait for completion,
 * stop watchers, release locks.
 *
 * @param closeServer - Optional callback to close the MCP server.
 */
export async function gracefulShutdown(signal: string, closeServer?: () => Promise<void>): Promise<void> {
  logger.info(`Received ${signal}, shutting down gracefully...`);

  // Signal all in-flight indexing in this process to stop at the next batch boundary
  for (const project of getIndexingInProgressProjects()) {
    requestCancellation(project);
  }

  await awaitActiveIndexing();
  await pluginManager.onShutdown();
  await stopAllWatchers();
  await releaseAllLocks();

  logger.info("Graceful shutdown complete");

  // Close the MCP server transport last — the host may have already severed
  // the stdio pipe (especially on SIGTERM), so server.close() can hang or
  // throw. Wrap in a timeout so the process still exits cleanly.
  if (closeServer) {
    try {
      await Promise.race([
        closeServer(),
        new Promise<void>((resolve) => setTimeout(resolve, 3_000)),
      ]);
    } catch {
      // Broken pipe or transport already closed — not fatal during shutdown
    }
  }
}
