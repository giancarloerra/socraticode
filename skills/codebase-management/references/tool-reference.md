# SocratiCode Management Tools — Full Reference

## codebase_index

Start indexing a codebase in the background. Returns immediately.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `projectPath` | string | no | cwd | Absolute path to the project directory |
| `extraExtensions` | string | no | — | Comma-separated additional extensions (e.g. ".tpl,.blade,.hbs"). Also via `EXTRA_EXTENSIONS` env var |

**Returns:** Confirmation that indexing started, with instructions to poll `codebase_status`.

**Key behaviours:**
- Runs asynchronously — does NOT block. Returns immediately.
- Auto-starts file watcher upon completion (if not cancelled)
- Ensures Docker/Qdrant/Ollama infrastructure is running first
- Concurrency guard: if already indexing, returns current progress instead of starting again
- Auto-indexes context artifacts defined in `.socraticodecontextartifacts.json`
- Auto-builds code graph after indexing completes
- Batched and resumable: checkpoints after each batch of 50 files. Interruptions don't lose work.

---

## codebase_update

Incrementally update an existing index. Only re-indexes changed files.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `projectPath` | string | no | cwd | Absolute path to the project directory |
| `extraExtensions` | string | no | — | Comma-separated additional extensions |

**Returns:** Statistics: files added/updated/removed, chunks created.

**Key behaviours:**
- Runs synchronously (blocking), unlike `codebase_index`
- Only processes files changed since last index (via content hash comparison)
- Auto-starts file watcher if not already active
- Usually not needed if the file watcher is running

---

## codebase_remove

Remove a project's entire index from the vector database.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `projectPath` | string | **yes** | — | Absolute path to the project directory |

**Returns:** Confirmation of removal.

**Key behaviours:**
- **Destructive** — cannot be undone
- Safely stops file watcher (same-process and cross-process)
- Cancels in-progress indexing and drains current batch
- Waits for in-flight graph builds to finish before deletion
- May refuse if indexing batch can't drain within 5 minutes (retry after)

---

## codebase_stop

Gracefully stop an in-progress indexing operation.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `projectPath` | string | no | cwd | Absolute path to the project directory |

**Returns:** Confirmation with current phase and batch info.

**Key behaviours:**
- Current batch finishes and checkpoints — all progress preserved
- Re-run `codebase_index` to resume from where it left off
- Handles both same-process and cross-process (orphan) indexing
- Sends SIGTERM to orphan processes holding the lock
- Non-destructive — progress is never lost

---

## codebase_watch

Start/stop/status of live file watching.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `projectPath` | string | no | cwd | Absolute path to the project directory |
| `action` | enum | **yes** | — | `"start"`, `"stop"`, or `"status"` |

**Returns:** Action result or list of watched projects.

**Key behaviours:**
- `start`: Runs catch-up incremental update first, then starts debounced file watcher
- `stop`: Stops same-process watcher (cross-process watchers unaffected)
- `status`: Lists all watched projects including cross-process watchers
- Detects if another process already watches the same project
- Auto-started after successful `codebase_index` or `codebase_update`
- Debounced with ~500ms delay to batch rapid file changes

---

## codebase_graph_build

Build the dependency graph using AST-based static analysis.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `projectPath` | string | no | cwd | Absolute path to the project directory |
| `extraExtensions` | string | no | — | Additional extensions included as leaf nodes (dependency targets) |

**Returns:** Confirmation that build started. Poll with `codebase_graph_status`.

**Key behaviours:**
- Runs asynchronously in background
- Auto-built during `codebase_index` (usually no need to call manually)
- Concurrency guard: if already building, shows progress
- Uses ast-grep for static import/require/export analysis across 18+ languages
- Skips files larger than 1 MB

---

## codebase_graph_remove

Remove a project's persisted code graph.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `projectPath` | string | **yes** | — | Absolute path to the project directory |

**Returns:** Confirmation of removal.

**Key behaviours:**
- **Destructive** — cannot be undone
- Waits for in-flight builds before deletion
- Graph auto-rebuilds during next `codebase_index`

---

## codebase_graph_status

Check graph build status and readiness.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `projectPath` | string | no | cwd | Absolute path to the project directory |

**Returns:** If building: phase, file progress, elapsed time. If ready: node/edge counts, last built timestamp, cache status, build duration.

---

## codebase_context_index

Index or re-index all context artifacts.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `projectPath` | string | no | cwd | Absolute path to the project directory |

**Returns:** Summary: artifacts indexed with chunk counts, any errors.

**Key behaviours:**
- Runs synchronously (blocking)
- Usually auto-triggered by `codebase_context_search` on first use
- Reports individual artifact errors without stopping the whole operation

---

## codebase_context_remove

Remove all indexed context artifacts.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `projectPath` | string | **yes** | — | Absolute path to the project directory |

**Returns:** Confirmation of removal.

**Key behaviours:**
- **Destructive** — cannot be undone
- Blocked while indexing is in progress (wait for finish or use `codebase_stop`)
- Removes ALL artifacts (not selective)

---

## codebase_health

Check infrastructure health: Docker, Qdrant, Ollama, embedding model.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| (none) | — | — | — | No parameters |

**Returns:** Status for each component with [OK]/[MISSING] indicators.

**Key behaviours:**
- Checks Docker availability
- Checks Qdrant (managed container or external endpoint)
- Checks embedding provider health (Ollama, OpenAI, or Google)
- Suggests fixes for missing components
- Works with both managed (Docker) and external (remote Qdrant) modes

---

## codebase_list_projects

List all projects that have been indexed.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| (none) | — | — | — | No parameters |

**Returns:** List with project paths, collection names, last indexed timestamp, file counts, graph info, context artifact status. Flags incomplete indexes.

---

## Architectural Behaviors

### Concurrency guards
- Only one indexing operation per project at a time
- Only one graph build per project at a time
- Duplicate operations return current progress instead of starting again

### Checkpoint & resume
- Indexing checkpoints after each batch of 50 files
- Interrupted indexing resumes from the last checkpoint automatically
- `codebase_stop` preserves all progress — resume with `codebase_index`

### Cross-process coordination
- File-based locking (`proper-lockfile`) prevents conflicts between multiple MCP instances
- Detects watchers/indexing running in other processes
- Can terminate orphan processes via SIGTERM
- Stale locks from crashed processes are auto-reclaimed

### Auto-features
- File watcher auto-starts after indexing/updates
- Context artifacts auto-indexed on first `codebase_context_search`
- Stale artifacts auto-detected and re-indexed
- Code graph auto-built after indexing
- Session resume: watcher restarts on first tool use for previously indexed projects

### Supported file extensions
**Built-in:** `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`, `.py`, `.pyw`, `.pyi`, `.java`, `.kt`, `.kts`, `.scala`, `.c`, `.h`, `.cpp`, `.hpp`, `.cc`, `.hh`, `.cxx`, `.cs`, `.go`, `.rs`, `.rb`, `.php`, `.swift`, `.sh`, `.bash`, `.zsh`, `.html`, `.htm`, `.css`, `.scss`, `.sass`, `.less`, `.vue`, `.svelte`, `.json`, `.yaml`, `.yml`, `.toml`, `.xml`, `.ini`, `.cfg`, `.md`, `.mdx`, `.rst`, `.txt`, `.sql`, `.dart`, `.lua`, `.r`, `.R`, `.dockerfile`

**Special files:** `Dockerfile`, `Makefile`, `Rakefile`, `Gemfile`, `Procfile`, `.env.example`, `.gitignore`, `.dockerignore`

**Custom:** Add via `extraExtensions` parameter or `EXTRA_EXTENSIONS` env var.

### Chunking defaults
- Chunk size: 100 lines, 10 lines overlap
- Batch size: 50 files per batch (for resumable checkpointing)
- Max chunk chars: 2000 (safety limit)
- Max file size: 5 MB (configurable via `MAX_FILE_SIZE_MB`)
