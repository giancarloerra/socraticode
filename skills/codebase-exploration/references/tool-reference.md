# SocratiCode Exploration Tools — Full Reference

## codebase_search

Semantic search across an indexed codebase. Only use after `codebase_index` is complete.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | yes | — | Natural language search query (e.g. "authentication middleware", "database connection setup") |
| `projectPath` | string | no | cwd | Absolute path to the project directory |
| `limit` | number (1-50) | no | 10 | Maximum results. Override globally via `SEARCH_DEFAULT_LIMIT` env var |
| `fileFilter` | string | no | — | Filter results to a specific file path (relative) |
| `languageFilter` | string | no | — | Filter results to a specific language (e.g. "typescript", "python") |
| `minScore` | number (0-1) | no | 0.10 | Minimum RRF score threshold. Override via `SEARCH_MIN_SCORE`. Set to 0 to disable |

**Returns:** Ranked code chunks with file paths, line numbers, language, and RRF scores.

**Key behaviours:**
- Uses hybrid semantic + keyword (BM25) search with Reciprocal Rank Fusion
- Warns if indexing is in progress (results will be incomplete during full index)
- Warns if file watcher is not active (results may be stale)
- Results below `minScore` are filtered out with a count of omitted results

---

## codebase_status

Check index status: chunk count, indexing progress, last completed operation, file watcher state.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `projectPath` | string | no | cwd | Absolute path to the project directory |

**Returns:** Detailed status including:
- Collection name and indexed chunk count
- In-progress indexing: phase, file/chunk progress percentage, batch info, elapsed time
- Last completed operation: type, files processed, chunks created, duration
- Incomplete index detection (previous run interrupted)
- Cross-process indexing detection (another process actively indexing)
- File watcher status (active / watched by another process / inactive)
- Code graph status (files, edges, last built, cached in memory)
- Context artifacts status

**Key behaviours:**
- Call every ~60 seconds during indexing to poll progress AND keep the MCP connection alive
- Detects both same-process and cross-process indexing

---

## codebase_graph_query

Query the dependency graph for a specific file.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `projectPath` | string | no | cwd | Absolute path to the project directory |
| `filePath` | string | yes | — | Relative path of the file to query (e.g. "src/index.ts") |

**Returns:** Two lists: what this file imports (→) and what depends on it (←).

**Key behaviours:**
- Requires graph to exist (auto-built after indexing, or use `codebase_graph_build`)
- Auto-starts file watcher on query
- Use relative paths (not absolute)

---

## codebase_graph_stats

Get statistics about the code dependency graph.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `projectPath` | string | no | cwd | Absolute path to the project directory |

**Returns:** Total files, edges, average dependencies per file, circular dependency count, language breakdown, top 10 most connected files, first 20 orphan files.

---

## codebase_graph_circular

Find circular dependencies in the codebase.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `projectPath` | string | no | cwd | Absolute path to the project directory |

**Returns:** List of circular dependency chains (up to 20, with total count).

**Key behaviours:**
- Detects transitive circular dependencies
- Useful for debugging subtle runtime issues caused by import cycles

---

## codebase_graph_visualize

Visualise the dependency graph. Two modes:

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `projectPath` | string | no | cwd | Absolute path to the project directory |
| `mode` | `"mermaid" \| "interactive"` | no | `"mermaid"` | Output format |
| `open` | boolean | no | `true` | In interactive mode, auto-open the browser |

**mode="mermaid"** (default) — returns a Mermaid flowchart code block. Nodes colour-coded by language, circular dependency edges highlighted in red. Renders inline in markdown viewers, VS Code, GitHub.

**mode="interactive"** — generates a self-contained HTML page (vendored Cytoscape.js + Dagre, works offline) written to the OS temp dir and opened in the user's default browser.
- File view and (when available) Symbol view toggle
- Click a node → sidebar with imports / dependents / symbols / line numbers
- Right-click → blast radius overlay (reverse-transitive closure)
- Live search, six layouts, PNG export
- Shareable file — commit to a PR or attach to chat

**Key behaviours:**
- Interactive mode always includes the file view; the symbol view toggle is available when the symbol graph fits under embed caps (≤ 20k symbols / ≤ 60k call edges). Above that cap, the HTML still works — use `codebase_impact` / `codebase_symbols` for symbol-level queries.
- Browser auto-open is best-effort. If it fails (headless environments, blocked browsers) the tool output still includes the file path.
- Choose this mode when the user asks for a visual, interactive, or shareable graph.

---

## codebase_graph_status

Check graph build status and progress.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `projectPath` | string | no | cwd | Absolute path to the project directory |

**Returns:** If building: phase, file progress, elapsed time. If ready: node/edge counts, last built timestamp, cache status, last build duration.

**Key behaviours:**
- Use to poll progress after `codebase_graph_build`
- Shows build errors if last build failed

---

## codebase_context

List all context artifacts defined in `.socraticodecontextartifacts.json`.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `projectPath` | string | no | cwd | Absolute path to the project directory |

**Returns:** Each artifact's name, description, path, and index status (chunk count, last indexed timestamp, or "not yet indexed"). If no config exists, provides a template.

---

## codebase_context_search

Semantic search across context artifacts.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | yes | — | Natural language query (e.g. "tables related to billing", "authentication endpoints") |
| `projectPath` | string | no | cwd | Absolute path to the project directory |
| `artifactName` | string | no | — | Filter to a specific artifact by name. Omit to search all |
| `limit` | number (1-50) | no | 10 | Maximum results |
| `minScore` | number (0-1) | no | 0.10 | Minimum RRF score threshold |

**Returns:** Artifact content chunks with artifact name, file path, line ranges, and scores.

**Key behaviours:**
- Auto-indexes artifacts on first use (no manual step needed)
- Auto-detects stale artifacts and re-indexes changed ones
- Works with any text-based artifact: SQL, OpenAPI, Terraform, K8s, YAML, markdown, etc.

---

## codebase_about

Display information about SocratiCode and all its tools.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| (none) | — | — | — | No parameters |

**Returns:** Tool summary by category, typical workflow, infrastructure status, version info.

---

## Tips

### Search tips
- A single `codebase_search` returns ranked snippets from the entire codebase in milliseconds — far cheaper than opening files speculatively
- The RRF score combines semantic similarity and keyword match; higher scores = better relevance
- Use `fileFilter` when you know the area, `languageFilter` when cross-language results are noisy
- Lower `minScore` to 0 when exploring broadly; raise it for precision

### Graph tips
- The graph is auto-built after `codebase_index` — usually no need to call `codebase_graph_build` manually
- `codebase_graph_visualize` generates Mermaid that renders in GitHub, VS Code, and most markdown viewers
- Check `codebase_graph_circular` when debugging mysterious behaviour — circular deps cause subtle issues

### Context artifact tips
- `codebase_context_search` auto-indexes on first use — just search, no setup needed
- Stale artifacts are auto-detected and re-indexed when content changes
- Use `artifactName` filter to target specific schemas or specs
- Supported types: SQL schemas, OpenAPI/Protobuf specs, Terraform configs, K8s manifests, architecture docs, env configs — any text-based file
