// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited
import path from "node:path";
import { collectionName, projectIdFromPath } from "../config.js";
import { SEARCH_DEFAULT_LIMIT, SEARCH_MIN_SCORE } from "../constants.js";
import { getGraphStatus } from "../services/code-graph.js";
import { getArtifactStatusSummary } from "../services/context-artifacts.js";
import { ensureQdrantReady } from "../services/docker.js";
import { getEmbeddingConfig } from "../services/embedding-config.js";
import { getEmbeddingProvider } from "../services/embedding-provider.js";
import type { IndexingProgress } from "../services/indexer.js";
import { getIndexingProgress, getLastCompleted, isIndexingInProgress } from "../services/indexer.js";
import { getLockHolderPid, } from "../services/lock.js";
import { ensureOllamaReady } from "../services/ollama.js";
import { getCollectionInfo, getProjectMetadata, searchChunks } from "../services/qdrant.js";
import { ensureWatcherStarted, isWatchedByAnyProcess, isWatching } from "../services/watcher.js";

/** Format an IndexingProgress into display lines (elapsed, progress, batches, graph). */
function formatProgressLines(progress: IndexingProgress): {
  elapsed: string;
  pct: string;
  progressLine: string;
  batchLine: string | undefined;
  graphLine: string;
} {
  const elapsed = ((Date.now() - progress.startedAt) / 1000).toFixed(0);

  const pct = progress.filesTotal > 0
    ? ` (${Math.round((progress.filesProcessed / progress.filesTotal) * 100)}%)`
    : "";

  const progressLine = (progress.chunksTotal && progress.chunksTotal > 0)
    ? `  Progress: ${progress.chunksProcessed ?? 0}/${progress.chunksTotal} chunks embedded (${Math.round(((progress.chunksProcessed ?? 0) / progress.chunksTotal) * 100)}%)`
    : `  Progress: ${progress.filesProcessed}/${progress.filesTotal} files${pct}`;

  const batchLine = (progress.batchesTotal && progress.batchesTotal > 1)
    ? `  Batches: ${progress.batchesProcessed ?? 0}/${progress.batchesTotal} completed (${progress.filesProcessed}/${progress.filesTotal} files)`
    : undefined;

  const graphLine = progress.phase === "building code graph"
    ? "Code graph: building now..."
    : "Code graph: pending — will be auto-built after indexing completes";

  return { elapsed, pct, progressLine, batchLine, graphLine };
}

export async function handleQueryTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const projectPath = (args.projectPath as string) || process.cwd();
  const resolvedPath = path.resolve(projectPath);
  const projectId = projectIdFromPath(resolvedPath);
  const collection = collectionName(projectId);

  // Auto-start watcher on any query/status interaction (fire-and-forget)
  ensureWatcherStarted(resolvedPath);

  switch (name) {
    case "codebase_search": {
      await ensureQdrantReady();
      // Only ensure Ollama infrastructure when using the Ollama embedding provider.
      // For OpenAI/Google providers, just ensure the provider is initialized.
      if (getEmbeddingConfig().embeddingProvider === "ollama") {
        await ensureOllamaReady();
      } else {
        await getEmbeddingProvider();
      }

      const query = args.query as string;
      const limit = (args.limit as number) || SEARCH_DEFAULT_LIMIT;
      const fileFilter = args.fileFilter as string | undefined;
      const languageFilter = args.languageFilter as string | undefined;

      const allResults = await searchChunks(collection, query, limit, fileFilter, languageFilter);

      // Apply minimum score threshold
      const minScore = (args.minScore as number) ?? SEARCH_MIN_SCORE;
      const results = minScore > 0
        ? allResults.filter((r) => r.score >= minScore)
        : allResults;
      const filteredCount = allResults.length - results.length;

      if (results.length === 0) {
        if (filteredCount > 0) {
          return `No results above score threshold ${minScore.toFixed(2)} for "${query}" in project ${resolvedPath}.\n${filteredCount} result${filteredCount === 1 ? " was" : "s were"} below the threshold. Try a broader query or lower the minScore parameter.`;
        }
        return `No results found for "${query}" in project ${resolvedPath}.\nMake sure the project has been indexed first using codebase_index.`;
      }

      const lines = [`Search results for "${query}" (${results.length} matches):\n`];

      if (isIndexingInProgress(resolvedPath)) {
        const progress = getIndexingProgress(resolvedPath);
        if (progress?.type === "full-index") {
          const pct = progress.filesTotal > 0
            ? `${Math.round((progress.filesProcessed / progress.filesTotal) * 100)}%`
            : "unknown";
          lines.push(`⚠ INCOMPLETE INDEX: A full index is currently in progress (${pct} done).`);
          lines.push("  These results are from the portion indexed so far and may be significantly incomplete.");
          lines.push("  Call codebase_status to check progress. Wait for indexing to complete for full results.\n");
        } else {
          lines.push("⚠ NOTE: An incremental index update is in progress. Results may be slightly stale.\n");
        }
      }

      if (!(await isWatchedByAnyProcess(resolvedPath))) {
        lines.push("\u26a0 WARNING: File watcher is not yet active for this project. Results may be stale.");
        lines.push("  The watcher is being started automatically. Run codebase_update to force an immediate catch-up.\n");
      }

      for (const r of results) {
        lines.push(`--- ${r.relativePath} (lines ${r.startLine}-${r.endLine}) [${r.language}] score: ${r.score.toFixed(4)} ---`);
        lines.push(r.content);
        lines.push("");
      }

      if (filteredCount > 0) {
        lines.push(`(${filteredCount} additional result${filteredCount === 1 ? "" : "s"} below score threshold ${minScore.toFixed(2)} omitted)`);
      }

      return lines.join("\n");
    }

    case "codebase_status": {
      try {
        await ensureQdrantReady();
      } catch {
        // Even if Qdrant is down, check if indexing is in progress (infra might be starting)
        if (isIndexingInProgress(resolvedPath)) {
          const progress = getIndexingProgress(resolvedPath);
          if (progress) {
            const { elapsed, progressLine, batchLine, graphLine } = formatProgressLines(progress);
            return [
              `Project: ${resolvedPath}`,
              "",
              `\u26a0 ${progress.type === "full-index" ? "Full index" : "Incremental update"} in progress`,
              `  Phase: ${progress.phase}`,
              progressLine,
              ...(batchLine ? [batchLine] : []),
              `  Elapsed: ${elapsed}s`,
              "",
              graphLine,
              "",
              "Qdrant is starting up. Keep calling codebase_status to check progress.",
            ].join("\n");
          }
        }
        return "Qdrant is not available. Run codebase_index first to set up infrastructure.";
      }

      const info = await getCollectionInfo(collection);

      // Check for in-progress indexing even if no collection exists yet
      if (!info) {
        if (isIndexingInProgress(resolvedPath)) {
          const progress = getIndexingProgress(resolvedPath);
          if (progress) {
            const { elapsed, progressLine, batchLine, graphLine } = formatProgressLines(progress);
            return [
              `Project: ${resolvedPath}`,
              "",
              `\u26a0 ${progress.type === "full-index" ? "Full index" : "Incremental update"} in progress`,
              `  Phase: ${progress.phase}`,
              progressLine,
              ...(batchLine ? [batchLine] : []),
              `  Elapsed: ${elapsed}s`,
              "",
              graphLine,
              "",
              "Index is being created. Keep calling codebase_status to check progress.",
            ].join("\n");
          }
        }
        return `No index found for project: ${resolvedPath}\nRun codebase_index to create one.`;
      }

      const metadata = await getProjectMetadata(collection);

      const statusLines = [
        `Project: ${resolvedPath}`,
        `Collection: ${collection}`,
        `Status: ${info.status}`,
        `Indexed chunks: ${info.pointsCount}`,
      ];

      // Detect persisted incomplete index (previous run was interrupted)
      if (metadata?.indexingStatus === "in-progress" && !isIndexingInProgress(resolvedPath)) {
        // Check if another process is actively indexing (cross-process lock)
        const orphanPid = await getLockHolderPid(resolvedPath, "index");
        if (orphanPid !== null) {
          statusLines.push("");
          statusLines.push(`⚠ ANOTHER PROCESS (PID ${orphanPid}) IS ACTIVELY INDEXING this project.`);
          statusLines.push(`  Files indexed so far: ${metadata.filesIndexed} of ${metadata.filesTotal} discovered`);
          statusLines.push(`  Chunks stored: ${info.pointsCount} (partial)`);
          statusLines.push("");
          statusLines.push("  This is likely an automatic resume of a previous indexing interruption.");
          statusLines.push("  You can use codebase_stop to terminate it (and restart it directly to watch progress if you want), or wait for it to finish.");
        } else {
          statusLines.push("");
          statusLines.push("⚠ INDEX IS INCOMPLETE — a previous indexing run was interrupted before finishing.");
          statusLines.push(`  Files indexed: ${metadata.filesIndexed} of ${metadata.filesTotal} discovered`);
          statusLines.push(`  Chunks stored: ${info.pointsCount} (partial)`);
          statusLines.push("");
          statusLines.push("  Run codebase_index to resume and complete the index.");
        }
      }

      // Show in-progress indexing
      if (isIndexingInProgress(resolvedPath)) {
        const progress = getIndexingProgress(resolvedPath);
        statusLines.push("");
        if (progress) {
          const { elapsed, progressLine, batchLine } = formatProgressLines(progress);
          statusLines.push(`⚠ ${progress.type === "full-index" ? "Full index" : "Incremental update"} in progress`);
          statusLines.push(`  Phase: ${progress.phase}`);
          statusLines.push(progressLine);
          if (batchLine) {
            statusLines.push(batchLine);
          }
          statusLines.push(`  Elapsed: ${elapsed}s`);
          if (progress.filesTotal > 0 && progress.filesProcessed < progress.filesTotal) {
            statusLines.push("");
            statusLines.push("Keep calling codebase_status to check progress until it reaches 100%.");
          }
        }
      } else {
        // Show last completed operation
        const completed = getLastCompleted(resolvedPath);
        if (completed) {
          statusLines.push("");
          const ago = ((Date.now() - completed.completedAt) / 1000).toFixed(0);
          const duration = (completed.durationMs / 1000).toFixed(1);
          if (completed.error) {
            statusLines.push(`Last operation: ${completed.type === "full-index" ? "Full index" : "Incremental update"} — FAILED`);
            statusLines.push(`  Error: ${completed.error}`);
            statusLines.push(`  ${ago}s ago (ran for ${duration}s)`);
          } else {
            statusLines.push(`Last operation: ${completed.type === "full-index" ? "Full index" : "Incremental update"} — completed`);
            statusLines.push(`  Files: ${completed.filesProcessed}, Chunks: ${completed.chunksCreated}`);
            statusLines.push(`  ${ago}s ago (took ${duration}s)`);
          }
        }
      }

      if (isWatching(resolvedPath)) {
        statusLines.push("");
        statusLines.push("File watcher: active (auto-updating on changes)");
      } else if (await isWatchedByAnyProcess(resolvedPath)) {
        statusLines.push("");
        statusLines.push("File watcher: active (watched by another process)");
      } else {
        statusLines.push("");
        statusLines.push("File watcher: inactive");
      }

      // Graph status
      try {
        const graphInfo = await getGraphStatus(resolvedPath);
        statusLines.push("");
        if (graphInfo) {
          statusLines.push(`Code graph: ${graphInfo.nodeCount} files, ${graphInfo.edgeCount} edges`);
          const graphAgo = ((Date.now() - new Date(graphInfo.lastBuiltAt).getTime()) / 1000).toFixed(0);
          statusLines.push(`  Last built: ${graphAgo}s ago${graphInfo.cached ? " (cached in memory)" : ""}`);
        } else if (isIndexingInProgress(resolvedPath)) {
          const progress = getIndexingProgress(resolvedPath);
          if (progress?.phase === "building code graph") {
            statusLines.push("Code graph: building now...");
          } else {
            statusLines.push("Code graph: pending — will be auto-built after indexing completes");
          }
        } else {
          statusLines.push("Code graph: not built");
          statusLines.push("  Run codebase_graph_build to build it, or codebase_index to re-index (graph is built automatically).");
        }
      } catch {
        // Graph status check failed — non-critical
      }

      // Context artifacts status
      try {
        const artifactSummary = await getArtifactStatusSummary(resolvedPath);
        if (artifactSummary) {
          statusLines.push("");
          statusLines.push(...artifactSummary.lines);
        }
      } catch {
        // Artifact status check failed — non-critical
      }

      return statusLines.join("\n");
    }

    default:
      return `Unknown tool: ${name}`;
  }
}
