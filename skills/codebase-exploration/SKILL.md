---
name: codebase-exploration
description: >-
  Explore and understand codebases using SocratiCode semantic search, dependency graphs,
  and context artifacts. Use when exploring code, understanding architecture, finding
  functions/types, analysing dependencies, searching database schemas or API specs,
  or when socraticode/codebase_search tools are available. Activates when the user asks
  about code structure, wants to find where a feature lives, or needs to understand
  how code is organised.
---

# SocratiCode Codebase Exploration

Use SocratiCode MCP tools to explore codebases efficiently. The core principle:
**search before reading** — the index gives you a map of the codebase in milliseconds;
raw file reading is expensive and context-consuming.

## Workflow

### 1. Start most explorations with `codebase_search`

Hybrid semantic + keyword search (vector + BM25, RRF-fused) runs in a single call.

- **Broad queries for orientation**: "how is authentication handled", "database connection setup", "error handling patterns"
- **Precise queries for symbol lookup**: exact function names, constants, type names
- Prefer search results to infer which files to read — do not speculatively open files
- Use `fileFilter` to narrow to a specific file path, `languageFilter` for a specific language
- Adjust `minScore` (default 0.10) for precision vs recall — lower for more results, higher for stricter matching

**When to use grep instead**: If you already know the exact identifier, error string, or regex pattern, grep/ripgrep is faster and more precise — no semantic gap to bridge. Use `codebase_search` when exploring, asking conceptual questions, or when you don't know which files to look in.

### 2. Follow the graph before following imports

Use `codebase_graph_query` to see what a file imports and what depends on it **before** diving into its contents. This prevents unnecessary reading of transitive dependencies.

- **`codebase_graph_query`** — imports and dependents for any file (pass relative path)
- **`codebase_graph_stats`** — architecture overview: total files, edges, most connected files, orphans, language breakdown
- **`codebase_graph_circular`** — find circular dependencies (these cause subtle runtime bugs; check proactively when debugging unexpected behaviour)
- **`codebase_graph_visualize`** — Mermaid diagram colour-coded by language, circular deps highlighted in red. Pass `mode: "interactive"` to open a self-contained HTML explorer (file + symbol views, blast-radius overlay, search, PNG export — works offline) instead.

The graph is auto-built after indexing. Use `codebase_graph_status` to check if the graph is ready.

### 3. Read files only after narrowing via search

Once search results clearly point to 1-3 files, read only the relevant sections. **Never read a file just to find out if it's relevant** — search first.

A single `codebase_search` call returns ranked, deduplicated snippets from across the entire codebase in milliseconds. This gives you a broad map at negligible token cost — far cheaper than opening files speculatively.

### 4. Leverage context artifacts for non-code knowledge

Projects can define a `.socraticodecontextartifacts.json` config to expose database schemas, API specs, infrastructure configs, architecture docs, and other project knowledge that lives outside source code.

- **`codebase_context`** — list available artifacts (names, descriptions, paths, index status)
- **`codebase_context_search`** — semantic search across all artifacts (or filter with `artifactName`)
- Artifacts are auto-indexed on first search and auto-detect staleness

Run `codebase_context` early to see what's available. Use `codebase_context_search` before asking about database structure, API contracts, or infrastructure.

### 5. Check status if something seems wrong

- **`codebase_status`** — check index status, progress, watcher state, graph status
- If search returns no results, the project may not be indexed yet
- If the watcher is inactive, results may be stale — run `codebase_update` or start the watcher

### 6. Get an overview of all tools

- **`codebase_about`** — quick reference of all SocratiCode tools and a typical workflow

## Goal → Tool Quick Reference

| Goal | Tool |
|------|------|
| Understand what a codebase does / where a feature lives | `codebase_search` (broad query) |
| Find a specific function, constant, or type | `codebase_search` (exact name) or grep |
| Find exact error messages, log strings, or regex patterns | grep / ripgrep |
| See what a file imports or what depends on it | `codebase_graph_query` |
| Get architecture overview (files, edges, most connected) | `codebase_graph_stats` |
| Spot circular dependencies | `codebase_graph_circular` |
| Visualise module structure (text / Mermaid) | `codebase_graph_visualize` |
| User asks for a visual / interactive / shareable graph | `codebase_graph_visualize mode="interactive"` |
| Check graph build status | `codebase_graph_status` |
| Verify index is up to date | `codebase_status` |
| Discover available schemas, specs, configs | `codebase_context` |
| Find database tables, API endpoints, infra configs | `codebase_context_search` |
| Quick overview of all tools | `codebase_about` |

For full parameter details on every tool, see [references/tool-reference.md](references/tool-reference.md).
