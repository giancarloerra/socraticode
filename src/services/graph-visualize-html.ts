// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited

/**
 * Interactive HTML graph visualiser.
 *
 * Builds a single self-contained HTML file that renders the project's
 * file-import graph (and, when available, the symbol-level call graph)
 * using a vendored Cytoscape.js + Dagre layout, so the file works offline
 * without any CDN access.
 *
 * The generated page contains:
 *   - The file-import graph as the primary view (always available).
 *   - A "Symbols" toggle that switches to the symbol-level call graph,
 *     available when the symbol graph fits within the embed caps.
 *   - Per-file symbol lists in the sidebar (names, kinds, line numbers).
 *   - Blast-radius and call-flow overlays (click or right-click a node).
 *   - Live search across files and symbols, six layouts, PNG export.
 *
 * Scale caps (to keep the HTML payload bounded for gigantic repos):
 *   - Symbol graph embedded only if `symbolCount <= MAX_SYMBOLS` and
 *     `edgeCount <= MAX_EDGES`. Above either cap the symbol toggle is
 *     disabled and a banner explains why; the file view still works.
 *   - Per-file symbol list always embedded (capped at `MAX_SYMS_PER_FILE`
 *     per file — the sidebar shows the first N and a "use codebase_symbols
 *     for full list" note).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getLanguageFromExtension } from "../constants.js";
import type { CodeGraph } from "../types.js";
import { findCircularDependencies } from "./graph-analysis.js";
import { logger } from "./logger.js";
import { loadFilePayload, loadSymbolGraphMeta } from "./symbol-graph-store.js";

// ── Assets locator ────────────────────────────────────────────────────
// Works in dev (tsx, src/) and prod (node, dist/): assets sit alongside
// the services directory in both layouts thanks to `scripts/copy-assets.mjs`.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.join(__dirname, "..", "assets");

// ── Caps ──────────────────────────────────────────────────────────────
const MAX_SYMBOLS = 20_000;     // total symbols embedded in the Symbols view
const MAX_EDGES = 60_000;       // total call edges embedded in the Symbols view
const MAX_SYMS_PER_FILE = 200;  // per-file list shown in the sidebar
const PARALLEL_LOAD_BATCH = 20; // Qdrant payload fetches in parallel

// ── Data contract (matches viewer-app.js) ─────────────────────────────
export interface VizFile {
  id: string;           // relative path
  label: string;        // basename
  language: string;
  deps: number;
  dependents: number;
  symbolCount: number;  // full count, even if list was truncated
}

export interface VizFileEdge {
  source: string;
  target: string;
  type: "import" | "re-export" | "dynamic-import";
  cyclic: boolean;
}

export interface VizSymbol {
  id: string;
  file: string;
  name: string;
  qualifiedName: string;
  kind: string;
  line: number;
}

export interface VizSymbolEdge {
  source: string;  // symbol id
  target: string;  // symbol id (first candidate)
  confidence: "unique" | "multiple-candidates" | "local" | "unresolved";
}

export interface VizData {
  project: { name: string; files: number; edges: number; symbols: number | null; callEdges: number | null; builtAt: string | null };
  files: VizFile[];
  fileEdges: VizFileEdge[];
  symbols: VizSymbol[];
  symbolEdges: VizSymbolEdge[];
  /** Per-file symbol list for the sidebar; capped to MAX_SYMS_PER_FILE */
  symbolsByFile: Record<string, VizSymbol[]>;
  symbolMode: "full" | "omitted" | "capped";
  symbolOmitReason?: string;
}

// ── Cached assets (read once per process) ─────────────────────────────
interface AssetCache {
  cytoscape: string;
  dagre: string;
  cytoscapeDagre: string;
  styles: string;
  app: string;
  template: string;
}
let _assetCache: AssetCache | null = null;

async function loadAssets(): Promise<AssetCache> {
  if (_assetCache) return _assetCache;
  const [cytoscape, dagre, cytoscapeDagre, styles, app, template] = await Promise.all([
    fs.readFile(path.join(ASSETS_DIR, "cytoscape.min.js"), "utf-8"),
    fs.readFile(path.join(ASSETS_DIR, "dagre.min.js"), "utf-8"),
    fs.readFile(path.join(ASSETS_DIR, "cytoscape-dagre.js"), "utf-8"),
    fs.readFile(path.join(ASSETS_DIR, "viewer-styles.css"), "utf-8"),
    fs.readFile(path.join(ASSETS_DIR, "viewer-app.js"), "utf-8"),
    fs.readFile(path.join(ASSETS_DIR, "viewer-template.html"), "utf-8"),
  ]);
  _assetCache = { cytoscape, dagre, cytoscapeDagre, styles, app, template };
  return _assetCache;
}

/** Reset the asset cache (for tests / hot-reload). */
export function resetVisualizeAssetCache(): void {
  _assetCache = null;
}

// ── Symbol-data loader ────────────────────────────────────────────────
interface SymbolLoadResult {
  mode: "full" | "omitted" | "capped";
  reason?: string;
  symbols: VizSymbol[];
  symbolEdges: VizSymbolEdge[];
  symbolsByFile: Record<string, VizSymbol[]>;
  perFileCount: Record<string, number>;
  symbolCount: number | null;
  edgeCount: number | null;
  builtAt: number | null;
}

async function loadSymbolDataForViz(
  projectId: string,
  fileGraph: CodeGraph,
): Promise<SymbolLoadResult> {
  const meta = await loadSymbolGraphMeta(projectId).catch(() => null);
  if (!meta) {
    return { mode: "omitted", reason: "no symbol graph meta", symbols: [], symbolEdges: [], symbolsByFile: {}, perFileCount: {}, symbolCount: null, edgeCount: null, builtAt: null };
  }

  const exceedsSymbols = meta.symbolCount > MAX_SYMBOLS;
  const exceedsEdges = meta.edgeCount > MAX_EDGES;

  const symbols: VizSymbol[] = [];
  const symbolEdges: VizSymbolEdge[] = [];
  const symbolsByFile: Record<string, VizSymbol[]> = {};
  const perFileCount: Record<string, number> = {};

  // Load per-file payloads in bounded parallel batches.
  for (let i = 0; i < fileGraph.nodes.length; i += PARALLEL_LOAD_BATCH) {
    const batch = fileGraph.nodes.slice(i, i + PARALLEL_LOAD_BATCH);
    const payloads = await Promise.all(
      batch.map((n) => loadFilePayload(projectId, n.relativePath).catch(() => null)),
    );
    for (const payload of payloads) {
      if (!payload) continue;
      perFileCount[payload.file] = payload.symbols.length;

      const vizSymbols = payload.symbols.slice(0, MAX_SYMS_PER_FILE).map((s) => ({
        id: s.id, file: payload.file, name: s.name, qualifiedName: s.qualifiedName, kind: s.kind, line: s.line,
      }));
      symbolsByFile[payload.file] = vizSymbols;

      if (!exceedsSymbols) {
        // Embed all symbols from the file into the top-level list (no cap there)
        for (const s of payload.symbols) {
          symbols.push({ id: s.id, file: payload.file, name: s.name, qualifiedName: s.qualifiedName, kind: s.kind, line: s.line });
        }
      }
      if (!exceedsEdges) {
        for (const e of payload.outgoingCalls) {
          const target = e.calleeCandidates[0];
          if (!target) continue;
          symbolEdges.push({ source: e.callerId, target, confidence: e.confidence });
        }
      }
    }
  }

  if (exceedsSymbols || exceedsEdges) {
    const parts: string[] = [];
    if (exceedsSymbols) parts.push(`${meta.symbolCount.toLocaleString()} symbols > ${MAX_SYMBOLS.toLocaleString()} cap`);
    if (exceedsEdges) parts.push(`${meta.edgeCount.toLocaleString()} call edges > ${MAX_EDGES.toLocaleString()} cap`);
    return {
      mode: "capped",
      reason: parts.join(", "),
      symbols: [], symbolEdges: [], symbolsByFile, perFileCount,
      symbolCount: meta.symbolCount, edgeCount: meta.edgeCount, builtAt: meta.builtAt,
    };
  }

  return {
    mode: "full",
    symbols, symbolEdges, symbolsByFile, perFileCount,
    symbolCount: meta.symbolCount, edgeCount: meta.edgeCount, builtAt: meta.builtAt,
  };
}

// ── File-graph → viz data ─────────────────────────────────────────────
function buildFileVizData(graph: CodeGraph): { files: VizFile[]; fileEdges: VizFileEdge[] } {
  // Circular-dependency edge set for highlighting
  const cyclicEdgeKeys = new Set<string>();
  const cycles = findCircularDependencies(graph);
  for (const cycle of cycles) {
    for (let i = 0; i < cycle.length - 1; i++) cyclicEdgeKeys.add(`${cycle[i]}->${cycle[i + 1]}`);
  }

  const files: VizFile[] = graph.nodes.map((n) => ({
    id: n.relativePath,
    label: path.basename(n.relativePath),
    language: getLanguageFromExtension(path.extname(n.relativePath).toLowerCase()),
    deps: n.dependencies.length,
    dependents: n.dependents.length,
    symbolCount: 0,
  }));

  // Dedupe edges (graph edges may repeat on multi-import files)
  const seen = new Set<string>();
  const fileEdges: VizFileEdge[] = [];
  for (const e of graph.edges) {
    const key = `${e.source}->${e.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    fileEdges.push({ source: e.source, target: e.target, type: e.type, cyclic: cyclicEdgeKeys.has(key) });
  }
  return { files, fileEdges };
}

// ── HTML escapers ─────────────────────────────────────────────────────
/** Escape text for safe interpolation into HTML text content / attrs. */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

/**
 * Serialize data for embedding inside a <script type="application/json">
 * block. Escapes every `<` as the JSON unicode escape `\u003c` so the HTML
 * parser cannot see a stray `</script>` anywhere inside the payload.
 */
function toEmbeddedJson(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

// ── Public API ────────────────────────────────────────────────────────
export interface InteractiveHtmlOptions {
  projectPath: string;
  projectName: string;
  projectId: string;
  graph: CodeGraph;
}

/**
 * Build the interactive HTML viewer for a project as a single
 * self-contained string. Includes the file-import graph unconditionally
 * and the symbol-level call graph when it fits within the embed caps.
 */
export async function buildInteractiveGraphHtml(opts: InteractiveHtmlOptions): Promise<{ html: string; stats: { files: number; fileEdges: number; symbolMode: string; symbols: number; symbolEdges: number } }> {
  const assets = await loadAssets();
  const { files, fileEdges } = buildFileVizData(opts.graph);
  const sym = await loadSymbolDataForViz(opts.projectId, opts.graph);

  // Attach full symbol counts to file viz rows
  for (const f of files) f.symbolCount = sym.perFileCount[f.id] ?? 0;

  const data: VizData = {
    project: {
      name: opts.projectName,
      files: files.length,
      edges: fileEdges.length,
      symbols: sym.symbolCount,
      callEdges: sym.edgeCount,
      builtAt: sym.builtAt ? new Date(sym.builtAt).toISOString() : null,
    },
    files,
    fileEdges,
    symbols: sym.symbols,
    symbolEdges: sym.symbolEdges,
    symbolsByFile: sym.symbolsByFile,
    symbolMode: sym.mode,
    symbolOmitReason: sym.reason,
  };

  // Use embedded counts (what's actually in this viewer) rather than the
  // authoritative meta counts — otherwise the top bar and the sidebar's
  // "All symbols" count can disagree. meta counts include synthetic
  // <module> placeholders and unresolved call edges that aren't rendered.
  let statsLine: string;
  if (sym.mode === "full") {
    statsLine = `${files.length} files · ${fileEdges.length} edges · ${sym.symbols.length} symbols · ${sym.symbolEdges.length} calls`;
  } else if (sym.mode === "capped") {
    // Can't embed — fall back to the authoritative meta counts and flag
    // the limitation so the number isn't mistaken for "this viewer's
    // explorable scope".
    statsLine = `${files.length} files · ${fileEdges.length} edges · ${sym.symbolCount ?? 0} symbols (capped) · ${sym.edgeCount ?? 0} calls (capped)`;
  } else {
    statsLine = `${files.length} files · ${fileEdges.length} edges`;
  }

  // Use function replacers for asset/data injection: string replacements
  // would interpret `$&`, `$'`, `` $` ``, and `$$` in the replacement, which
  // corrupts vendored bundles (cytoscape.min.js and dagre.min.js both contain
  // a regex-escape idiom of the form `\$&`).
  const html = assets.template
    .replace(/\{\{TITLE\}\}/g, escapeHtml(`${opts.projectName} — SocratiCode graph`))
    .replace(/\{\{PROJECT_NAME\}\}/g, escapeHtml(opts.projectName))
    .replace(/\{\{STATS\}\}/g, escapeHtml(statsLine))
    .replace("{{STYLES}}", () => assets.styles)
    .replace("{{CYTOSCAPE}}", () => assets.cytoscape)
    .replace("{{DAGRE}}", () => assets.dagre)
    .replace("{{CYTOSCAPE_DAGRE}}", () => assets.cytoscapeDagre)
    .replace("{{DATA_JSON}}", () => toEmbeddedJson(data))
    .replace("{{APP}}", () => assets.app);

  logger.info("Built interactive graph HTML", {
    project: opts.projectName,
    files: files.length,
    fileEdges: fileEdges.length,
    symbolMode: sym.mode,
    symbols: sym.symbols.length,
    symbolEdges: sym.symbolEdges.length,
    htmlBytes: html.length,
  });

  return {
    html,
    stats: {
      files: files.length,
      fileEdges: fileEdges.length,
      symbolMode: sym.mode,
      symbols: sym.symbols.length,
      symbolEdges: sym.symbolEdges.length,
    },
  };
}
