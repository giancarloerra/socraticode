# Developer Guide

This document covers the internals of **SocratiCode** — architecture, data flow, configuration, and how to build, extend, and debug.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Prerequisites for Development](#prerequisites-for-development)
- [Building and Running](#building-and-running)
- [Project Structure](#project-structure)
- [Configuration & Constants](#configuration--constants)
- [Data Flow: Indexing](#data-flow-indexing)
- [Data Flow: Search](#data-flow-search)
- [Data Flow: Incremental Update](#data-flow-incremental-update)
- [Data Flow: Code Graph](#data-flow-code-graph)
- [Testing](#testing)
- [Services Reference](#services-reference)
- [MCP Tools Reference](#mcp-tools-reference)
- [Data Structures](#data-structures)
- [Docker & Infrastructure](#docker--infrastructure)
- [Extending the Indexer](#extending-the-indexer)
- [Troubleshooting](#troubleshooting)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                    MCP Host                         │
│            (VS Code, Claude Desktop, etc.)          │
└──────────────────────┬──────────────────────────────┘
                       │ stdio (JSON-RPC)
┌──────────────────────▼──────────────────────────────┐
│              MCP Server (src/index.ts)               │
│                                                      │
│  ┌──────────┐ ┌───────────┐ ┌───────┐ ┌──────────┐ │
│  │ Index    │ │ Query     │ │ Graph │ │ Manage   │ │
│  │ Tools    │ │ Tools     │ │ Tools │ │ Tools    │ │
│  └────┬─────┘ └─────┬─────┘ └───┬───┘ └────┬─────┘ │
│       │             │           │           │        │
│  ┌────▼─────────────▼───────────▼───────────▼─────┐ │
│  │                  Services                       │ │
│  │  ┌─────────┐ ┌────────┐ ┌────────┐ ┌────────┐ │ │
│  │  │ Indexer │ │ Qdrant │ │ Ollama │ │ Docker │ │ │
│  │  │         │ │ Client │ │ Client │ │ Mgmt   │ │ │
│  │  └────┬────┘ └───┬────┘ └───┬────┘ └───┬────┘ │ │
│  │       │          │          │           │       │ │
│  │  ┌────▼────┐ ┌───▼────┐ ┌──▼──────┐           │ │
│  │  │ Ignore  │ │Embedder│ │ Watcher │           │ │
│  │  │ Filter  │ │        │ │(@parcel) │           │ │
│  │  └─────────┘ └────────┘ └─────────┘           │ │
│  └─────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
         │                           │
         ▼                           ▼
┌──────────────────┐      ┌─────────────────────┐
│  Qdrant (Docker)  │      │  Ollama (Docker)     │
│  localhost:16333  │      │  localhost:11435     │
│                   │      │                      │
│  Vector storage   │      │  nomic-embed-text    │
│  768-dim cosine   │      │  768-dim embeddings  │
└──────────────────┘      └─────────────────────┘
```

---

## Prerequisites for Development

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 18+ | Runtime |
| npm | 9+ | Package manager |
| TypeScript | 5.7+ | Installed as devDependency |
| Docker | Any recent | Runs Qdrant |
| Ollama | Any recent | Runs embedding model |

---

## Building and Running

### Install dependencies

```bash
npm install
```

### Build

```bash
npm run build
```

This compiles TypeScript from `src/` to `dist/` with source maps and declarations.

### Run directly (development)

```bash
npm run dev
```

Uses `tsx` to run TypeScript directly without a build step.

### Run built version

```bash
npm start
# or
node dist/index.js
```

The server communicates over **stdio** using JSON-RPC (MCP protocol). It's designed to be launched by an MCP host, not run standalone in a terminal. For testing, you can use the MCP Inspector or pipe JSON-RPC messages.

### TypeScript Configuration

- **Target**: ES2022
- **Module**: Node16 (ESM)
- **Strict mode**: Enabled
- **Output**: `dist/` with source maps and `.d.ts` declarations

### Linting

SocratiCode uses [Biome](https://biomejs.dev/) for linting. Biome is fast, zero-config, and catches unused imports, style issues, and potential bugs.

```bash
# Check for lint issues
npm run lint

# Auto-fix safe issues
npm run lint:fix
```

For VS Code, install the [Biome extension](https://marketplace.visualstudio.com/items?itemName=biomejs.biome) for real-time lint feedback and auto-fix on save.

### Versioning & Releases

SocratiCode uses [Conventional Commits](https://www.conventionalcommits.org/) and [release-it](https://github.com/release-it/release-it) for automated versioning and changelog generation.

**Commit message format:**

```
feat: add fuzzy search support        → Features
fix: resolve race condition            → Bug Fixes
perf: optimise embedding batching      → Performance
refactor: simplify provider factory    → Refactors
docs: update quickstart guide          → Documentation
test: add watcher edge-case tests      → Tests
chore: update deps                     → hidden from changelog
```

**Before committing:**

```bash
npm run lint && npx tsc --noEmit && npm run test:unit
```

**Creating a release** (maintainers only):

```bash
# Interactive — prompts for patch/minor/major
npm run release

# Dry run — preview what will happen without making changes
npm run release:dry
```

This will automatically:
1. Determine the version bump from your commits
2. Update `CHANGELOG.md` with all `feat:`, `fix:`, etc. entries
3. Bump the version in `package.json`
4. Create a git commit and tag (`v1.1.0`)
5. Push to GitHub and create a GitHub Release

---

## Project Structure

```
src/
├── index.ts                 # MCP server entry point — registers all 21 tools
├── config.ts                # Project ID generation (SHA-256), collection naming, linked projects, branch detection
├── constants.ts             # All constants: ports, container names, models, chunk sizes, extensions
├── types.ts                 # TypeScript interfaces and types
│
├── services/
│   ├── docker.ts            # Docker CLI wrapper — manage Qdrant & Ollama containers
│   ├── ollama.ts            # Ollama client — model availability, embedding calls
│   ├── embeddings.ts        # Embedding generation with batching and task prefixes
│   ├── qdrant.ts            # Qdrant client — collections, upsert, search, metadata
│   ├── indexer.ts           # Core indexing — file discovery, chunking, full/incremental
│   ├── watcher.ts           # File system watcher via @parcel/watcher with debouncing
│   ├── lock.ts              # Cross-process file-based locking via proper-lockfile
│   ├── ignore.ts            # Ignore filter (.gitignore + .socraticodeignore + defaults)
│   ├── logger.ts            # Structured JSON logging — stderr (startup/no MCP transport) or MCP notifications/message (when hosted)
│   ├── code-graph.ts        # AST-based code graph building via ast-grep
│   ├── graph-analysis.ts    # Graph queries: dependencies, stats, cycles, Mermaid diagrams
│   ├── graph-aliases.ts     # Path alias resolution from tsconfig/jsconfig compilerOptions.paths
│   ├── graph-imports.ts     # Import/require/use extraction for 18+ languages via AST
│   ├── graph-resolution.ts  # Module specifier → file path resolution (incl. aliases, SCSS partials)
│   ├── startup.ts           # Startup lifecycle: auto-resume, graceful shutdown coordination
│   └── context-artifacts.ts # Context artifact loading, chunking, indexing, search
│
├── tools/
│   ├── index-tools.ts       # Handlers: codebase_index, codebase_update, codebase_remove, codebase_stop, codebase_watch
│   ├── query-tools.ts       # Handlers: codebase_search, codebase_status
│   ├── graph-tools.ts       # Handlers: codebase_graph_build/query/stats/circular/visualize
│   ├── context-tools.ts     # Handlers: codebase_context, codebase_context_search/index/remove
│   └── manage-tools.ts      # Handlers: codebase_health, codebase_list_projects, codebase_about

tests/
├── helpers/
│   ├── fixtures.ts          # Test fixture utilities (temp projects, Docker checks)
│   └── setup.ts             # Integration test infrastructure (Qdrant client, cleanup)
├── unit/                    # 608 tests — no Docker required
├── integration/             # 137 tests — requires Docker
└── e2e/                     # 20 tests — full lifecycle

docker-compose.yml           # Alternative way to run infrastructure
vitest.config.ts             # Test framework configuration
```

---

## Configuration & Constants

All constants are defined in `src/constants.ts`:

| Constant | Value | Description |
|----------|-------|-------------|
| `SEARCH_DEFAULT_LIMIT` | `10` | Default search results per query (env-configurable, 1-50) |
| `SEARCH_MIN_SCORE` | `0.10` | Minimum RRF score threshold (env-configurable, 0-1) |
| `CHUNK_SIZE` | `100` | Lines per chunk |
| `CHUNK_OVERLAP` | `10` | Overlapping lines between adjacent chunks |
| `MAX_FILE_BYTES` | `5 MB` | Max file size before skipping (env-configurable via `MAX_FILE_SIZE_MB`) |
| `MAX_AVG_LINE_LENGTH` | `500` | Avg line length above which character-based chunking is used (minified files) |
| `MAX_CHUNK_CHARS` | `2000` | Hard character limit per chunk (provider-level safety net) |
| `QDRANT_PORT` | `16333` | Qdrant HTTP API port (host-side) |
| `QDRANT_GRPC_PORT` | `16334` | Qdrant gRPC port (host-side) |
| `QDRANT_CONTAINER_NAME` | `socraticode-qdrant` | Docker container name |
| `QDRANT_IMAGE` | `qdrant/qdrant:v1.17.0` | Docker image (pinned version) |
| `OLLAMA_PORT` | `11435` | Ollama API port (host-side) |
| `OLLAMA_CONTAINER_NAME` | `socraticode-ollama` | Docker container name |
| `OLLAMA_IMAGE` | `ollama/ollama:latest` | Docker image |

> **Note**: `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`, and `EMBEDDING_CONTEXT_LENGTH` are defined in `src/services/embedding-config.ts`, not in `src/constants.ts`. Defaults are `nomic-embed-text` / `768` for Ollama, `text-embedding-3-small` / `1536` for OpenAI, and `gemini-embedding-001` / `3072` for Google.

### Embedding batch size

Defined in `src/services/embeddings.ts`: texts are sent to Ollama in batches of **32**.

### File watcher debounce

Defined in `src/services/watcher.ts`: file changes are debounced for **2000ms** before triggering an index update.

### Maximum file size

Defined in `src/constants.ts` as `MAX_FILE_BYTES`: files larger than **5 MB** are skipped (configurable via `MAX_FILE_SIZE_MB` env var).

### Qdrant health check

Defined in `src/services/docker.ts`: after starting the container, the server polls `/healthz` up to **30 times** with **1000ms** between retries.

### Project ID & Collection Naming

Defined in `src/config.ts`:
- **Project ID**: First 12 characters of SHA-256 hash of the absolute project path.
- **Code collection**: `codebase_{projectId}`
- **Graph collection**: `codegraph_{projectId}`
- **Context artifacts collection**: `context_{projectId}`

This means the same folder path always maps to the same collection, even across restarts.

#### Branch-aware mode

When `SOCRATICODE_BRANCH_AWARE=true`, the current git branch is detected via `git rev-parse --abbrev-ref HEAD` and appended to the project ID (e.g. `abc123def456__feat_my-feature`). Branch names are sanitized: non-alphanumeric characters (except `-`) become `_`, consecutive underscores collapse, leading/trailing underscores are stripped. Detached HEAD states fall back to the branchless ID. Ignored when `SOCRATICODE_PROJECT_ID` is set explicitly.

#### Linked projects

`loadLinkedProjects()` reads `.socraticode.json` and `SOCRATICODE_LINKED_PROJECTS` env var. `resolveLinkedCollections()` maps linked paths to `{ name, label }` descriptors for `searchMultipleCollections()`. The current project is always first (highest dedup priority).

### Supported File Extensions (54)

| Category | Extensions |
|----------|-----------|
| JavaScript/TypeScript | `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs` |
| Python | `.py`, `.pyw`, `.pyi` |
| Java/Kotlin/Scala | `.java`, `.kt`, `.kts`, `.scala` |
| C/C++ | `.c`, `.h`, `.cpp`, `.hpp`, `.cc`, `.hh`, `.cxx` |
| C# | `.cs` |
| Go | `.go` |
| Rust | `.rs` |
| Ruby | `.rb` |
| PHP | `.php` |
| Swift | `.swift` |
| Shell | `.sh`, `.bash`, `.zsh` |
| Web | `.html`, `.htm`, `.css`, `.scss`, `.sass`, `.less`, `.vue`, `.svelte` |
| Config | `.json`, `.yaml`, `.yml`, `.toml`, `.xml`, `.ini`, `.cfg` |
| Documentation | `.md`, `.mdx`, `.rst`, `.txt` |
| SQL | `.sql` |
| Dart | `.dart` |
| Lua | `.lua` |
| R | `.r`, `.R` |
| Docker | `.dockerfile` |

Special files always indexed: `Dockerfile`, `Makefile`, `Rakefile`, `Gemfile`, `Procfile`, `.env.example`, `.gitignore`, `.dockerignore`.

### Built-in Ignore Patterns (45)

The full list is in `src/services/ignore.ts`. Key entries: `node_modules`, `.git`, `dist`, `build`, `.next`, `__pycache__`, `.venv`, `target`, `.idea`, `.vscode`, `*.min.js`, `*.lock`, `package-lock.json`, `yarn.lock`, `coverage`, `vendor`, `.DS_Store`, `Thumbs.db`.

---

## Data Flow: Indexing

When `codebase_index` is called:

```
1. INFRASTRUCTURE CHECK
   handleIndexTool() → ensureQdrantReady() + ensureOllamaReady()
   ├── Check Docker CLI: docker info
   ├── Check Qdrant image: docker images (qdrant/qdrant:v1.17.0)
   ├── Pull image if missing: docker pull qdrant/qdrant:v1.17.0
   ├── Check container: docker ps --filter name=socraticode-qdrant
   ├── Create/start container with volume mount
   ├── Wait for /healthz (up to 30s, 30 × 1s retries)
   ├── Check Ollama container: docker ps --filter name=socraticode-ollama
   ├── Start Ollama container if needed
   ├── Check for nomic-embed-text model
   └── Pull model if missing

2. FILE DISCOVERY
   getIndexableFiles(projectPath, extraExts?)
   ├── glob("**/*") to enumerate all files
   ├── Build ignore filter: defaults + .gitignore + .socraticodeignore
   ├── Filter by supported extension, special filename, or extra extensions
   └── Filter out ignored paths

3. COLLECTION SETUP
   ensureCollection(collectionName)
   ├── Check if collection exists
   ├── Create with: provider-dependent dimensions (768/1536/3072), cosine distance, on-disk payload
   └── Create payload indexes: filePath, relativePath, language, contentHash

4. FILE SCANNING & CHUNKING (parallel batches of 50 files)
   ├── Read file content (skip if > 5 MB or unreadable)
   ├── Hash content: SHA-256 → 16-char prefix
   ├── Skip if hash matches existing (re-index mode)
   ├── Chunk using three-tier strategy:
   │   ├── Minified/bundled (avg line length > 500): character-based chunking
   │   │   └── Splits at safe boundaries (newline, space, semicolon, comma)
   │   ├── AST-aware (supported languages): chunk at function/class boundaries
   │   │   ├── ast-grep parses top-level declarations
   │   │   ├── Small declarations merged, large ones sub-chunked
   │   │   └── Preamble (imports) and epilogue handled separately
   │   └── Line-based fallback: 100-line segments with 10-line overlap
   ├── Hard character cap (2000 chars) applied to all chunks
   ├── Generate chunk ID: SHA-256 of "filePath:startLine" formatted as UUID
   └── Detect language from file extension

5. BATCHED EMBEDDING + UPSERT (50 files per batch)
   For each batch of files:
   ├── Prepare text: "search_document: {relativePath}\n{content}"
   ├── Generate embeddings via configured provider (further batched internally)
   ├── Upsert to Qdrant with dense vector + BM25 text + payload
   ├── Update in-memory file hashes
   ├── Checkpoint: persist hashes to Qdrant (progress survives crashes)
   └── Check for cancellation request before next batch

6. POST-INDEX
   ├── Save final metadata (status: "completed")
   ├── Auto-build code dependency graph (non-fatal on failure)
   └── Auto-index context artifacts if config exists (non-fatal on failure)
```

---

## Data Flow: Search

When `codebase_search` is called:

```
1. Generate query embedding
   ├── Prepare text: "search_query: {query}"
   └── Send to configured embedding provider → provider-dependent vector (768 / 1536 / 3072 dims)

2. HYBRID SEARCH (dense + BM25, RRF-fused)
   ├── Build two parallel prefetch sub-queries:
   │   ├── Dense: query vector → semantic cosine similarity (client-side)
   │   └── BM25:  query text  → server-side BM25 inference (Qdrant v1.15.2+)
   ├── Apply optional filters (filePath, language) as payload conditions on both sub-queries
   ├── Qdrant Query API runs both sub-queries then fuses results via Reciprocal Rank Fusion (RRF)
   └── Return top N results with RRF-combined scores and payloads

3. Format results
   └── Each result: file path, line range, language, RRF score, code content
```

### nomic-embed-text Task Prefixes

The `nomic-embed-text` model uses task-specific prefixes for asymmetric retrieval:
- **Documents** are prefixed with `search_document: ` — this tells the model to encode the text as a passage to be retrieved.
- **Queries** are prefixed with `search_query: ` — this tells the model to encode as a search query.

This asymmetric encoding significantly improves retrieval quality.

---

## Data Flow: Incremental Update

When `codebase_update` is called:

```
1. Check if collection exists and has points
   └── If empty/missing → fall back to full indexProject()

2. Enumerate current files on disk
   └── Same filtering as full index (extensions, ignore rules)

3. Compare against in-memory hash map
   ├── File hash matches → skip (unchanged)
   ├── File hash differs → delete old chunks, re-chunk, re-embed, upsert
   ├── File not in hash map → new file, chunk, embed, upsert
   └── Hash map entry not on disk → deleted file, remove chunks

4. Return delta: { added, updated, removed, chunksCreated, cancelled }
```

> **Note**: File content hashes are persisted in Qdrant after each batch. On server restart, hashes are loaded from Qdrant on first use, so incremental updates remain truly incremental across restarts.

---

## Data Flow: Code Graph

When `codebase_graph_build` is called:

```
0. CONCURRENCY GUARD
   ├── If a build is already in progress for this project, return the
   │   existing in-flight promise (deduplication — callers share the result)
   └── Otherwise, start a new tracked build

1. BACKGROUND EXECUTION (fire-and-forget)
   ├── Tool returns immediately with "build started" message
   ├── Actual build runs asynchronously on the event loop
   ├── Progress tracked via GraphBuildProgress { filesTotal, filesProcessed, phase }
   └── Client polls codebase_graph_status for progress %

2. FILE DISCOVERY (phase: "scanning files")
   ├── Get graphable files from project (same ignore filters as indexing)
   └── Include files with AST-grep grammar + files with extra extensions

3. PARSE IMPORTS (phase: "analyzing imports", per file, via ast-grep)
   ├── Determine AST-grep language from file extension
   │   ├── Built-in: TypeScript, JavaScript, Python, Java, Kotlin, etc.
   │   └── Dynamic: C, C++, C#, Go, Rust, Ruby, PHP, Swift, Bash, Scala
   ├── Files with extra extensions (no AST grammar) → leaf nodes only
   ├── Parse file with ast-grep
   ├── Extract import/require/use/include statements using AST patterns
   │   ├── JavaScript/TypeScript: import ... from, require(), dynamic import()
   │   ├── Python: import, from ... import
   │   ├── Java/Kotlin/Scala: import statements
   │   ├── Go: import declarations
   │   ├── Rust: use, mod
   │   ├── Ruby: require, require_relative
   │   ├── PHP: use, require, include
   │   ├── C/C++: #include
   │   ├── Swift: import
   │   ├── Bash: source, . (dot)
   │   ├── Dart/Lua: regex-based extraction
   │   ├── Svelte/Vue: HTML parse → <script> extraction → re-parse as TypeScript
   │   ├── Svelte/Vue: HTML parse → <style> extraction → CSS @import/@require regex
   │   └── CSS/SCSS/SASS/LESS: @import/@import url()/@require regex extraction
   ├── Tag CSS imports with isCssImport flag (for correct resolution extensions)
   ├── Update progress: filesProcessed++
   └── Return ImportInfo[] with module specifiers

4. RESOLVE IMPORTS
   ├── Load path aliases from tsconfig.json/jsconfig.json (once per build)
   │   ├── Parse compilerOptions.paths + baseUrl
   │   ├── Follow "extends" chains (up to 10 levels, circular-safe)
   │   └── Fall back to jsconfig.json if tsconfig has no paths
   ├── For each import, resolve module specifier to actual file path
   ├── Handle relative paths: ./foo → foo.ts, foo/index.ts, etc.
   ├── Try path alias resolution: $lib/foo → src/lib/foo.ts, @/bar → src/bar.ts
   ├── Try extension variations per language (JS/TS extensions or CSS extensions)
   ├── SCSS partial resolution: @import "vars" → _vars.scss
   ├── CSS imports from <style> blocks → resolved with CSS extensions (.css/.scss/.sass/.less/.styl)
   ├── Check against known file set for existence
   └── Skip unresolvable imports (external packages, built-ins)

5. BUILD GRAPH
   ├── Create node for each file: { filePath, relativePath, imports[], dependencies[], dependents[] }
   ├── Create edges for resolved dependencies: { source, target }
   └── Back-fill dependents lists from edges

6. PERSIST (phase: "persisting")
   └── Save graph data to Qdrant

7. CACHE in-memory (per project) for subsequent queries
   └── Cache invalidated on graph rebuild or file watcher events
```

> **Note**: Graph builds are always full reconstructions, not incremental. Unlike
> the indexer where each file's embedding chunks are independent, the graph's
> edges are global — a single file change can affect edges across many files.
> Graph builds are fast since they only do local AST parsing (no network calls
> like embedding generation). The concurrency guard ensures that duplicate builds
> from multiple callers (tool, watcher, indexer, auto-resume) are deduplicated.

### Circular Dependency Detection

Uses depth-first search (DFS) with a recursion stack to find cycles in the directed dependency graph.

---

## Testing

SocratiCode uses **vitest** as its test framework with **765 tests** across three layers.

### Running Tests

```bash
# All tests
npm test

# Unit tests only (no Docker needed)
npm run test:unit

# Integration tests only (requires Docker)
npm run test:integration

# End-to-end tests (requires Docker)
npm run test:e2e

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage
```

### Test Architecture

| Layer | Directory | Tests | Docker | Description |
|-------|-----------|-------|--------|-------------|
| Unit | `tests/unit/` | 608 | No | Pure logic: config, constants, ignore rules, cross-process locking, logging, graph analysis, import extraction, path resolution, startup lifecycle |
| Integration | `tests/integration/` | 137 | Yes | Real Docker containers: Qdrant CRUD, real Ollama embeddings, indexer, watcher, code graph, all 21 MCP tools |
| E2E | `tests/e2e/` | 20 | Yes | Full lifecycle: health check → index → search → graph build/query/stats → watch → remove |

### Test Infrastructure

- **`tests/helpers/fixtures.ts`** — Creates temporary fixture projects with TypeScript, Python files, and supporting config. Provides `isDockerAvailable()` for conditional test skipping.
- **`tests/helpers/setup.ts`** — Manages test Qdrant collections with `createTestQdrantClient()`, `cleanupTestCollections()`, cache reset helpers, and infrastructure readiness polling (`waitForQdrant()`, `waitForOllama()`).

### Key Design Decisions

- **Sequential execution**: Tests run sequentially (`fileParallelism: false`) because integration tests share Docker containers.
- **Automatic skip**: Integration/E2E tests use `describe.skipIf(!dockerAvailable)` to gracefully skip when Docker is unavailable.
- **120-second timeouts**: Both test and hook timeouts are set to 120s to accommodate Docker image pulls and embedding model downloads on first run.
- **Real embeddings**: Integration tests use real Ollama embeddings (not mocks) to validate semantic search quality.
- **Fixture cleanup**: Each test cleans up its temporary directories and Qdrant collections.

### Configuration

Test configuration is in `vitest.config.ts`:

```typescript
{
  pool: "forks",              // Process isolation
  testTimeout: 120_000,       // 2 minutes per test
  hookTimeout: 120_000,       // 2 minutes per hook
  fileParallelism: false,     // Sequential file execution
  sequence: { concurrent: false },
  coverage: { include: ["src/**/*.ts"], exclude: ["src/index.ts"] }
}
```

---

## Services Reference

### docker.ts

| Function | Signature | Description |
|----------|-----------|-------------|
| `isDockerAvailable` | `() → Promise<boolean>` | Runs `docker info` to check |
| `isQdrantImagePresent` | `() → Promise<boolean>` | Checks `docker images` |
| `pullQdrantImage` | `(onProgress?) → Promise<void>` | Runs `docker pull` |
| `isQdrantRunning` | `() → Promise<boolean>` | Checks `docker ps` |
| `startQdrant` | `(onProgress?) → Promise<void>` | Creates and starts Qdrant container |
| `resetQdrantReadinessCache` | `() → void` | Clear cached readiness state |
| `ensureQdrantReady` | `(onProgress?) → Promise<{ started, pulled }>` | Full Qdrant setup orchestration |
| `isOllamaImagePresent` | `() → Promise<boolean>` | Checks for Ollama Docker image |
| `pullOllamaImage` | `(onProgress?) → Promise<void>` | Pulls Ollama Docker image |
| `isOllamaRunning` | `() → Promise<boolean>` | Checks Ollama container status |
| `startOllama` | `(onProgress?) → Promise<void>` | Creates and starts Ollama container |
| `resetOllamaContainerReadinessCache` | `() → void` | Clear cached readiness state |
| `ensureOllamaContainerReady` | `(onProgress?) → Promise<{ started, pulled }>` | Full Ollama container setup |

Qdrant container is started with:
```
docker run -d \
  --name socraticode-qdrant \
  -p 16333:6333 -p 16334:6334 \
  -v socraticode_qdrant_data:/qdrant/storage \
  --restart unless-stopped \
  qdrant/qdrant:v1.17.0
```

Ollama container is started with:
```
docker run -d \
  --name socraticode-ollama \
  -p 11435:11434 \
  -v socraticode_ollama_data:/root/.ollama \
  --restart unless-stopped \
  ollama/ollama:latest
```

### ollama.ts

| Function | Signature | Description |
|----------|-----------|-------------|
| `isOllamaAvailable` | `() → Promise<boolean>` | Calls Ollama API to check availability |
| `isModelAvailable` | `() → Promise<boolean>` | Checks for the configured `EMBEDDING_MODEL` |
| `pullModel` | `() → Promise<void>` | Pulls the model |
| `embed` | `(texts: string[]) → Promise<number[][]>` | Batch embedding |
| `embedSingle` | `(text: string) → Promise<number[]>` | Single embedding |
| `resetOllamaReadinessCache` | `() → void` | Clear cached readiness state |
| `ensureOllamaReady` | `() → Promise<{ modelPulled, containerStarted, imagePulled }>` | Full setup: container + model |

Ollama connectivity URL is configurable via the `OLLAMA_URL` environment variable (resolved via `embedding-config.ts`). Both the container and embedding model are managed automatically.

### embedding-types.ts

Shared TypeScript interfaces for all embedding providers. Extracted to avoid circular imports between the factory and the provider implementations.

| Export | Description |
|--------|-------------|
| `EmbeddingProvider` *(interface)* | Contract all providers implement: `name`, `ensureReady()`, `embed()`, `embedSingle()`, `healthCheck()` |
| `EmbeddingReadinessResult` | Returned by `ensureReady()`: `{ modelPulled, containerStarted, imagePulled }` |
| `EmbeddingHealthStatus` | Returned by `healthCheck()`: `{ available, modelReady, statusLines }` |

### embedding-config.ts

Loads and caches embedding configuration from environment variables. Singleton — loaded once, cached for the process lifetime.

| Export | Description |
|--------|-------------|
| `loadEmbeddingConfig` | `() → EmbeddingConfig` — Load and cache config from env vars. Throws on invalid values. |
| `getEmbeddingConfig` | `() → EmbeddingConfig` — Get cached config (loads if not yet loaded). |
| `setResolvedOllamaMode` | `(mode, url) → void` — Update config after `OLLAMA_MODE=auto` probes native Ollama. |
| `resetEmbeddingConfig` | `() → void` — Clear cache (for testing). |

Key env vars: `EMBEDDING_PROVIDER`, `OLLAMA_MODE`, `OLLAMA_URL`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`, `EMBEDDING_CONTEXT_LENGTH`, `OLLAMA_API_KEY`.

### embedding-provider.ts

Factory that creates and caches the active `EmbeddingProvider` instance. Uses dynamic `import()` to avoid loading all provider SDKs at startup.

| Export | Description |
|--------|-------------|
| `getEmbeddingProvider` | `(onProgress?) → Promise<EmbeddingProvider>` — Get (or create) the active provider singleton. Re-creates if config changed. |
| `resetEmbeddingProvider` | `() → void` — Clear cached provider (for testing). |

Provider selected via `EMBEDDING_PROVIDER` env var (`ollama` / `openai` / `google`).

### provider-ollama.ts

Ollama embedding provider. Supports Docker-managed, external, and auto-detect modes.

| Export | Description |
|--------|-------------|
| `OllamaEmbeddingProvider` | Main provider class implementing `EmbeddingProvider`. |
| `isOllamaAvailable` | `() → Promise<boolean>` — Calls `ollama.list()` to check reachability. |
| `isModelAvailable` | `() → Promise<boolean>` — Checks if the configured model is pulled. |
| `pullModel` | `() → Promise<void>` — Pull the configured model. |
| `resetOllamaReadinessCache` | `() → void` — Force re-check on next `ensureReady()` call. |
| `resetAutoDetectionCache` | `() → void` — Re-run `OLLAMA_MODE=auto` probe on next call (for testing). |

`ensureReady()` handles the full setup sequence: auto-detect native Ollama → start Docker container if needed → pull model. Has a 60s TTL cache to avoid re-checking on every embedding call.

### provider-openai.ts

OpenAI embedding provider. Requires `OPENAI_API_KEY`.

| Export | Description |
|--------|-------------|
| `OpenAIEmbeddingProvider` | Provider class. Uses `client.embeddings.create()` with native batching (up to 512 inputs/request). |
| `resetOpenAIClient` | `() → void` — Clear cached client (for testing). |

`ensureReady()` validates the API key and calls `models.list()` to confirm connectivity. Pre-truncates inputs to the model's context window (default 8191 tokens, ~3 chars/token estimate for code).

### provider-google.ts

Google Generative AI embedding provider. Requires `GOOGLE_API_KEY`.

| Export | Description |
|--------|-------------|
| `GoogleEmbeddingProvider` | Provider class. Uses `batchEmbedContents()` (up to 100 inputs/request). |
| `resetGoogleClient` | `() → void` — Clear cached client (for testing). |

`ensureReady()` validates the API key and makes a minimal test embedding call. Pre-truncates to 2048 tokens (~3 chars/token). Default model is `gemini-embedding-001` (3072 dims).

### qdrant.ts

| Function | Signature | Description |
|----------|-----------|-------------|
| `ensureCollection` | `(name) → Promise<void>` | Create collection with dense + BM25 vectors and payload indexes |
| `ensurePayloadIndex` | `(collName, fieldName) → Promise<void>` | Create a payload index (idempotent) |
| `deleteCollection` | `(name) → Promise<void>` | Drop collection |
| `listCodebaseCollections` | `() → Promise<string[]>` | List `codebase_*`, `codegraph_*`, and `context_*` entries |
| `upsertChunks` | `(collection, chunks, contentHash) → Promise<void>` | Generate embeddings and upsert (batches of 100) |
| `upsertPreEmbeddedChunks` | `(collection, points) → Promise<{ pointsSkipped }>` | Upsert pre-embedded points with per-point fallback |
| `deleteFileChunks` | `(collection, filePath) → Promise<void>` | Remove all chunks for a file |
| `searchChunks` | `(collection, query, limit?, fileFilter?, languageFilter?) → Promise<SearchResult[]>` | Hybrid search (dense + BM25, RRF-fused) |
| `searchChunksWithFilter` | `(collection, query, limit, filters) → Promise<SearchResult[]>` | Hybrid search with arbitrary payload filters |
| `getCollectionInfo` | `(name) → Promise<{ pointsCount, status } \| null>` | Collection info (null if not found, throws on transient errors) |
| `resetMetadataCollectionCache` | `() → void` | Reset cached metadata collection readiness (testing) |
| `saveProjectMetadata` | `(collName, projectPath, filesTotal, filesIndexed, fileHashes, indexingStatus) → Promise<void>` | Persist project metadata and file hashes |
| `loadProjectHashes` | `(collName) → Promise<Map<string, string> \| null>` | Load file content hashes (throws on transient errors) |
| `getProjectMetadata` | `(collName) → Promise<{ projectPath, filesIndexed, ... } \| null>` | Read project metadata (null on error) |
| `deleteProjectMetadata` | `(collName) → Promise<void>` | Remove project metadata (best-effort) |
| `saveGraphData` | `(graphCollName, projectPath, graph) → Promise<void>` | Persist code graph to metadata |
| `loadGraphData` | `(graphCollName) → Promise<CodeGraph \| null>` | Load persisted code graph (null on error) |
| `getGraphMetadata` | `(graphCollName) → Promise<{ projectPath, lastBuiltAt, ... } \| null>` | Read graph metadata (null on error) |
| `deleteGraphData` | `(graphCollName) → Promise<void>` | Remove graph data (best-effort) |
| `saveContextMetadata` | `(contextCollName, projectPath, artifacts) → Promise<void>` | Persist context artifact metadata |
| `loadContextMetadata` | `(contextCollName) → Promise<ArtifactIndexState[] \| null>` | Load context artifact states (null on error) |
| `getContextMetadata` | `(contextCollName) → Promise<{ projectPath, lastIndexedAt, ... } \| null>` | Read context metadata (null on error) |
| `deleteContextMetadata` | `(contextCollName) → Promise<void>` | Remove context metadata (best-effort) |
| `deleteArtifactChunks` | `(collection, artifactName) → Promise<void>` | Remove all chunks for a specific artifact |
| `IndexingStatus` | `type` | `"in-progress" \| "completed"` |

### embeddings.ts

| Function | Signature | Description |
|----------|-----------|-------------|
| `generateEmbeddings` | `(texts: string[]) → Promise<number[][]>` | Batch generate embeddings with `search_document:` prefix |
| `generateQueryEmbedding` | `(query: string) → Promise<number[]>` | Single query embedding with `search_query:` prefix |
| `prepareDocumentText` | `(content, filePath) → string` | Prepare text with relative path prefix |

### indexer.ts

| Export | Signature | Description |
|--------|-----------|-------------|
| `IndexingProgress` | *(interface)* | Progress details for an in-flight indexing operation: type, phase, files/chunks/batches processed |
| `IndexingCompleted` | *(interface)* | Summary of a completed indexing operation: type, duration, files processed, chunks created, optional error |
| `isIndexingInProgress` | `(projectPath) → boolean` | Check if a project is currently being indexed |
| `getIndexingProgress` | `(projectPath) → IndexingProgress \| null` | Get progress details for an in-flight operation |
| `setIndexingProgress` | `(projectPath, progress) → void` | Set or clear progress (used by index-tools during infrastructure setup) |
| `getLastCompleted` | `(projectPath) → IndexingCompleted \| null` | Get the last completed indexing operation |
| `getIndexingInProgressProjects` | `() → string[]` | List all projects currently being indexed |
| `getPersistedIndexingStatus` | `(projectPath) → Promise<"completed" \| "in-progress" \| "unknown">` | Check persisted indexing status in Qdrant metadata |
| `requestCancellation` | `(projectPath) → boolean` | Request graceful cancellation (stops after current batch) |
| `hashContent` | `(content) → string` | SHA-256 hash (16-char hex prefix) for change detection |
| `chunkId` | `(filePath, startLine) → string` | Generate a stable UUID chunk ID from file path and line number |
| `isIndexableFile` | `(fileName, extraExts?) → boolean` | Check if a file should be indexed based on extension or name |
| `chunkFileContent` | `(filePath, relativePath, content) → FileChunk[]` | AST-aware chunking with line-based and character-based fallbacks |
| `getIndexableFiles` | `(projectPath, extraExts?) → Promise<string[]>` | Discover files respecting ignore rules + extra extensions |
| `indexProject` | `(projectPath, onProgress?, extraExtensions?) → Promise<{ filesIndexed, chunksCreated, cancelled }>` | Full index with batched/resumable pipeline |
| `updateProjectIndex` | `(projectPath, onProgress?, extraExtensions?) → Promise<{ added, updated, removed, chunksCreated, cancelled }>` | Incremental update |
| `removeProjectIndex` | `(projectPath) → Promise<void>` | Delete index, code graph, and context artifacts |

### watcher.ts

| Function | Signature | Description |
|----------|-----------|-------------|
| `startWatching` | `(projectPath, onProgress?) → Promise<boolean>` | Start @parcel/watcher native subscription. Returns `true` if now watching (or already was), `false` if another process holds the lock or subscription failed |
| `stopWatching` | `(projectPath) → Promise<void>` | Stop watcher |
| `stopAllWatchers` | `() → Promise<void>` | Stop all watchers |
| `isWatching` | `(projectPath) → boolean` | Check if a project is being watched **by this process** |
| `isWatchedByAnyProcess` | `(projectPath) → Promise<boolean>` | Cross-process check: local subscriptions first, then file-based lock |
| `getWatchedProjects` | `() → string[]` | List watched paths |
| `ensureWatcherStarted` | `(projectPath) → void` | Fire-and-forget auto-start with TTL cache: checks not watching, not externally watched (60s cache), not indexing, collection exists |
| `clearExternalWatchCache` | `() → void` | Clear the external watch TTL cache (for testing) |

Watcher settings:
- Uses native OS file watching: FSEvents (macOS), ReadDirectoryChangesW (Windows), inotify (Linux)
- Single native subscription per directory tree — no per-file enumeration
- Error throttling: logs first 3 errors, then every 100th
- Auto-stops after 10 consecutive errors
- Cross-process lock prevents duplicate watchers
- Cross-process status awareness: `codebase_status` and `codebase_search` detect watchers running in other MCP processes via file-based locks
- Auto-starts on first tool interaction with an indexed project (search, status, update, graph), with 60-second TTL cache to avoid retrying when another process holds the lock

### code-graph.ts

| Function | Signature | Description |
|----------|-----------|-------------|
| `buildCodeGraph` | `(projectPath, extraExtensions?, progress?) → Promise<CodeGraph>` | Build dependency graph via ast-grep with optional progress tracking |
| `getOrBuildGraph` | `(projectPath, extraExtensions?) → Promise<CodeGraph>` | Get cached graph or build new one |
| `rebuildGraph` | `(projectPath, extraExtensions?) → Promise<CodeGraph>` | Force rebuild with concurrency guard (joins existing build if in progress) |
| `invalidateGraphCache` | `(projectPath) → void` | Clear cached graph for project |
| `isGraphBuildInProgress` | `(projectPath) → boolean` | Check if graph build is running |
| `getGraphBuildProgress` | `(projectPath) → GraphBuildProgress \| null` | Get in-flight build progress |
| `getLastGraphBuildCompleted` | `(projectPath) → GraphBuildCompleted \| null` | Get last completed build info |
| `getGraphBuildInProgressProjects` | `() → string[]` | List all projects currently building |
| `ensureDynamicLanguages` | `() → void` | Register dynamic ast-grep language grammars |
| `getAstGrepLang` | `(ext) → Lang \| string \| null` | Map file extension to ast-grep language |

### graph-analysis.ts

| Function | Signature | Description |
|----------|-----------|-------------|
| `getFileDependencies` | `(graph, relativePath) → { imports, importedBy }` | Query single file |
| `findCircularDependencies` | `(graph) → string[][]` | DFS cycle detection |
| `getGraphStats` | `(graph) → { totalFiles, totalEdges, ... }` | Summary statistics |
| `generateMermaidDiagram` | `(graph) → string` | Generate Mermaid dependency diagram |

### context-artifacts.ts

| Export | Signature | Description |
|--------|-----------|-------------|
| `SocratiCodeConfig` | *(interface)* | Parsed `.socraticodecontextartifacts.json` shape: `{ artifacts?: ContextArtifact[] }` |
| `loadConfig` | `(projectPath) → Promise<SocratiCodeConfig \| null>` | Load and validate config file (null if missing, throws on parse/validation errors) |
| `readArtifactContent` | `(artifactPath, projectPath) → Promise<{ content, contentHash }>` | Read file or directory content with SHA-256 hash for staleness detection |
| `chunkArtifactContent` | `(content, artifactName, artifactPath) → ArtifactChunk[]` | Line-based chunking with overlap (same `CHUNK_SIZE`/`CHUNK_OVERLAP` as code) |
| `indexArtifact` | `(projectPath, artifact, collection) → Promise<ArtifactIndexState>` | Index a single artifact: read → chunk → embed → upsert to Qdrant |
| `indexAllArtifacts` | `(projectPath) → Promise<{ indexed, errors }>` | Index all artifacts from config, saving metadata. Errors per-artifact, never throws. |
| `ensureArtifactsIndexed` | `(projectPath) → Promise<{ reindexed, upToDate, errors }>` | Staleness check: compare content hashes, re-index only changed artifacts, remove deleted ones |
| `searchArtifacts` | `(projectPath, query, artifactName?, limit?) → Promise<SearchResult[]>` | Hybrid semantic + BM25 search across context artifacts with optional name filter |
| `removeAllArtifacts` | `(projectPath) → Promise<void>` | Delete context collection and metadata for a project |
| `getArtifactStatusSummary` | `(projectPath) → Promise<{ configuredCount, indexedCount, totalChunks, lines } \| null>` | Compact status summary (null if no config file). Used by `codebase_status` and `codebase_list_projects`. |

### graph-imports.ts

| Function | Signature | Description |
|----------|-----------|-------------|
| `extractImports` | `(source, lang, ext) → ImportInfo[]` | Extract imports from source using ast-grep AST patterns |

Supports 18+ languages including TypeScript, JavaScript, Python, Java, Kotlin, Go, Rust, Ruby, PHP, C, C++, C#, Swift, Scala, Bash, Dart, and Lua.

### graph-resolution.ts

| Function | Signature | Description |
|----------|-----------|-------------|
| `resolveImport` | `(specifier, importerPath, projectRoot, fileSet, language) → string \| null` | Resolve module specifier to file path |

### lock.ts

| Function | Signature | Description |
|----------|-----------|-------------|
| `acquireProjectLock` | `(projectPath, operation) → Promise<boolean>` | Acquire cross-process lock (returns false if held by another process) |
| `releaseProjectLock` | `(projectPath, operation) → Promise<void>` | Release a previously acquired lock |
| `isProjectLocked` | `(projectPath, operation) → Promise<boolean>` | Check if a lock is currently held by any process |
| `getLockHolderPid` | `(projectPath, operation) → Promise<number \| null>` | Get PID of the process holding the lock (null if none) |
| `terminateLockHolder` | `(projectPath, operation) → Promise<{ terminated, pid }>` | Send SIGTERM to an orphan lock-holder process |
| `releaseAllLocks` | `() → Promise<void>` | Release all locks held by this process (graceful shutdown) |

Lock settings:
- Lock files stored in `os.tmpdir()/socraticode-locks/`
- Staleness threshold: 2 minutes (locks auto-reclaim if holder crashes)
- Refresh interval: 30 seconds
- Uses `proper-lockfile` for atomic, cross-platform file-based locking

### ignore.ts

| Function | Signature | Description |
|----------|-----------|-------------|
| `createIgnoreFilter` | `(projectPath) → Ignore` | Build combined filter |
| `shouldIgnore` | `(ig, relativePath) → boolean` | Check if path is ignored |

---

## MCP Tools Reference

### Indexing Tools

#### `codebase_index`
```
Parameters:
  projectPath?: string     — Absolute path (defaults to cwd)
  extraExtensions?: string — Comma-separated extra file extensions (e.g. '.tpl,.blade,.hbs')

Returns: Infrastructure setup messages + "Indexing started" confirmation (runs in background)
```

#### `codebase_update`
```
Parameters:
  projectPath?: string     — Absolute path (defaults to cwd)
  extraExtensions?: string — Comma-separated extra file extensions (e.g. '.tpl,.blade')

Returns: Count of added/updated/removed files and new chunks
```

#### `codebase_stop`
```
Parameters:
  projectPath?: string  — Absolute path (defaults to cwd)

Returns: Cancellation confirmation with current phase, or orphan process termination status
```

#### `codebase_remove`
```
Parameters:
  projectPath: string  — Absolute path (required)

Returns: Confirmation message

Behaviour:
  1. Stops the file watcher (if active) to prevent updates on a deleted index.
  2. Cancels any in-progress indexing or incremental update and waits for it to
     drain (up to 30 s timeout — proceeds anyway if it does not stop in time).
  3. Waits for any in-flight code graph build to finish.
  4. Deletes the vector collection, graph, context artifacts, and metadata.
```

#### `codebase_watch`
```
Parameters:
  projectPath?: string  — Absolute path (defaults to cwd)
  action: "start" | "stop" | "status"

Returns: Status message or list of watched projects
```

### Query Tools

#### `codebase_search`
```
Parameters:
  query: string           — Natural language search query (required)
  projectPath?: string    — Absolute path (defaults to cwd)
  limit?: number          — 1-50 (default 10)
  fileFilter?: string     — Filter by relative file path
  languageFilter?: string — Filter by language name
  minScore?: number       — 0-1, minimum RRF score threshold (default: 0.10, env: SEARCH_MIN_SCORE)

Returns: Ranked code chunks with file paths, line numbers, language, similarity scores, and content
```

#### `codebase_status`
```
Parameters:
  projectPath?: string  — Absolute path (defaults to cwd)

Returns: Collection name, status, and indexed chunk count
```

### Graph Tools

#### `codebase_graph_build`
```
Parameters:
  projectPath?: string        — Absolute path (defaults to cwd)
  extraExtensions?: string    — Comma-separated extra extensions

Behavior: Starts graph build in the background (fire-and-forget).
  If a build is already in progress, returns current progress instead.
  Uses concurrency guard — duplicate callers share the same build.

Returns: "Build started" message with instructions to poll codebase_graph_status
```

#### `codebase_graph_query`
```
Parameters:
  projectPath?: string  — Absolute path (defaults to cwd)
  filePath: string      — Relative file path to query (required)

Returns: List of dependencies (imports) and dependents (imported by)
```

#### `codebase_graph_stats`
```
Parameters:
  projectPath?: string  — Absolute path (defaults to cwd)

Returns: Statistics: total files, edges, avg dependencies, top 10 most connected, orphans, circular dep count
```

#### `codebase_graph_circular`
```
Parameters:
  projectPath?: string  — Absolute path (defaults to cwd)

Returns: List of circular dependency chains (up to 20 displayed)
```

#### `codebase_graph_visualize`
```
Parameters:
  projectPath?: string  — Absolute path (defaults to cwd)

Returns: Mermaid diagram of the dependency graph, color-coded by language
```

#### `codebase_graph_remove`
```
Parameters:
  projectPath: string  — Absolute path (required)

Returns: Confirmation message

Behaviour:
  Waits for any in-flight graph build to finish before removing the persisted
  graph data and clearing the in-memory cache.
```

#### `codebase_graph_status`
```
Parameters:
  projectPath?: string  — Absolute path (defaults to cwd)

Returns:
  If build in progress: Status BUILDING with phase, progress %, elapsed time
  If ready: Status READY with node/edge count, last built time, cache status, last build duration
  If not found: Instructions to build
```

### Management Tools

#### `codebase_health`
```
Parameters: none

Returns: Status of Docker, Qdrant image, Qdrant container, Ollama, and embedding model
```

#### `codebase_list_projects`
```
Parameters: none

Returns: List of all Qdrant collections (indexed projects and their graph status)
```

#### `codebase_about`
```
Parameters: none

Returns: Information about SocratiCode — philosophy, features, and capabilities
```

### Context Artifact Tools

#### `codebase_context`
```
Parameters:
  projectPath?: string  — Absolute path (defaults to cwd)

Returns: List of all artifacts defined in .socraticodecontextartifacts.json with names, descriptions, paths, and index status
```

#### `codebase_context_search`
```
Parameters:
  query: string         — Natural language search query
  projectPath?: string  — Absolute path (defaults to cwd)
  artifactName?: string — Filter to a specific artifact name
  limit?: number        — Max results (default: 10, range: 1-50)
  minScore?: number     — 0-1, minimum RRF score threshold (default: 0.10, env: SEARCH_MIN_SCORE)

Returns: Ranked context chunks matching the query. Auto-indexes on first use, auto-detects staleness.
```

#### `codebase_context_index`
```
Parameters:
  projectPath?: string  — Absolute path (defaults to cwd)

Returns: Number of indexed artifacts and chunks per artifact
```

#### `codebase_context_remove`
```
Parameters:
  projectPath: string  — Absolute path (required)

Returns: Confirmation message

Behaviour:
  Refuses removal if indexing/update is in progress (which includes context
  artifact indexing). Returns a message suggesting codebase_stop or waiting.
```

---

## Data Structures

### FileChunk

```typescript
interface FileChunk {
  id: string;            // SHA-256 of "filePath:startLine" formatted as UUID (36 chars, 8-4-4-4-12)
  filePath: string;      // Absolute path
  relativePath: string;  // Relative to project root
  content: string;       // Chunk text content
  startLine: number;     // 1-based line number
  endLine: number;       // Inclusive
  language: string;      // Detected from extension
  type: "code" | "comment" | "mixed";
}
```

### SearchResult

```typescript
interface SearchResult {
  filePath: string;
  relativePath: string;
  content: string;
  startLine: number;
  endLine: number;
  language: string;
  score: number;         // RRF (Reciprocal Rank Fusion) score from hybrid search
}
```

### CodeGraph / CodeGraphNode / CodeGraphEdge

```typescript
interface CodeGraph {
  nodes: CodeGraphNode[];
  edges: CodeGraphEdge[];
}

interface CodeGraphNode {
  filePath: string;
  relativePath: string;
  imports: string[];      // Module specifiers (e.g. "./utils")
  exports: string[];
  dependencies: string[]; // Resolved relative paths
  dependents: string[];   // Files that import this file
}

interface CodeGraphEdge {
  source: string;         // Relative path of importer
  target: string;         // Relative path of imported
  type: "import" | "re-export" | "dynamic-import";
}
```

### HealthStatus

```typescript
interface HealthStatus {
  docker: boolean;
  ollama: boolean;
  qdrant: boolean;
  ollamaModel: boolean;
  qdrantImage: boolean;
  ollamaImage: boolean;
}
```

### ContextArtifact / ArtifactIndexState

```typescript
/** A context artifact defined in .socraticodecontextartifacts.json */
interface ContextArtifact {
  name: string;          // Unique name (e.g. "database-schema")
  path: string;          // File or directory path (relative or absolute)
  description: string;   // Describes what this artifact is and how AI should use it
}

/** Runtime state of an indexed artifact */
interface ArtifactIndexState {
  name: string;
  description: string;
  resolvedPath: string;  // Absolute path
  contentHash: string;   // For staleness detection
  lastIndexedAt: string; // ISO timestamp
  chunksIndexed: number; // Number of chunks stored in Qdrant
}
```

### ProjectConfig

```typescript
interface ProjectConfig {
  projectId: string;          // 12-char SHA-256 prefix
  projectPath: string;
  collectionName: string;     // "codebase_{projectId}"
  graphCollectionName: string; // "codegraph_{projectId}"
  lastIndexedAt?: string;
}
```

---

## Docker & Infrastructure

### Qdrant Container

The server manages a single Qdrant container with these settings:

```
Name:    socraticode-qdrant
Image:   qdrant/qdrant:v1.17.0
Ports:   16333:6333 (HTTP REST API), 16334:6334 (gRPC)
Volume:  socraticode_qdrant_data:/qdrant/storage
Restart: unless-stopped
```

### Ollama Container

The server manages a single Ollama container:

```
Name:    socraticode-ollama
Image:   ollama/ollama:latest
Ports:   11435:11434 (API)
Volume:  socraticode_ollama_data:/root/.ollama
Restart: unless-stopped
```

**Data persistence**: The named Docker volumes persist across container restarts and upgrades. Your indexes and models survive server and Docker restarts.

**Alternative**: Instead of the server auto-managing the containers, you can run them yourself via `docker-compose up -d` using the included `docker-compose.yml`. The server will detect the already-running containers and skip creation.

### Qdrant Collection Schema

Each project gets a collection with:

- **Vectors**: Provider-dependent dimensions (768 for Ollama, 1536 for OpenAI, 3072 for Google), cosine distance
- **Optimizers**: 2 segments
- **Payload storage**: On-disk (to handle large codebases)
- **Payload indexes**: `filePath` (keyword), `relativePath` (keyword), `language` (keyword), `contentHash` (keyword)

---

## Extending the Indexer

### Adding a new file extension

Edit `SUPPORTED_EXTENSIONS` and `getLanguageFromExtension()` in `src/constants.ts`.

### Changing chunk size or overlap

Edit `CHUNK_SIZE` and `CHUNK_OVERLAP` in `src/constants.ts`. Smaller chunks give more precise search results but use more storage and embedding calls. Larger chunks give more context per result.

### Switching embedding model or provider

1. Set `EMBEDDING_PROVIDER` in your MCP config env block (`ollama`, `openai`, or `google`).
2. Optionally override `EMBEDDING_MODEL` and `EMBEDDING_DIMENSIONS` for the chosen provider (auto-detected defaults exist for all built-in models).
3. Re-index all projects (`codebase_remove` then `codebase_index`) since existing vectors have different dimensions.

See `src/services/embedding-config.ts` for all supported environment variables and per-provider defaults.

### Adding a new MCP tool

1. Define the handler in the appropriate file under `src/tools/`
2. Register the tool in `src/index.ts` using `server.tool()`
3. Follow the existing pattern: zod schema for input, string return value

### Adding new ignore patterns

Edit `DEFAULT_IGNORE_PATTERNS` in `src/services/ignore.ts`.

---

## Troubleshooting

### "Docker is not available"

Make sure Docker Desktop is installed and running. On Linux, ensure the Docker daemon is started and your user is in the `docker` group.

### "Ollama is not available"

The Ollama container is managed automatically via Docker. Check that the `socraticode-ollama` container is running with `docker ps`. If it's not starting, check `docker logs socraticode-ollama`.

### Qdrant health check times out

The container may be slow to start. Try:
```bash
docker logs socraticode-qdrant
```

### Search returns no results

Make sure the project has been indexed first (`codebase_index`). Check the status with `codebase_status`.

### Code graph returns empty

The code graph uses ast-grep for AST-based import extraction. It works for 18+ languages. If a file has no recognized imports (or uses non-standard import patterns), it may appear as an orphan node.

### Large codebase is slow to index

- Initial indexing is CPU/IO intensive (embedding generation). Subsequent updates are incremental and much faster.
- Files over 5 MB are automatically skipped (configurable via `MAX_FILE_SIZE_MB`).
- Consider adding large generated or data files to `.socraticodeignore`.

### Server crashes on startup

Check that the `dist/` directory exists. Run `npm run build` first.

### Qdrant Manual Management

Qdrant exposes a REST API on port 16333. You can inspect and clean up directly via `curl`:

**List all collections:**
```bash
curl -s http://localhost:16333/collections | python3 -m json.tool
```

**Delete a specific collection:**
```bash
curl -X DELETE http://localhost:16333/collections/codebase_<projectId>
curl -X DELETE http://localhost:16333/collections/codegraph_<projectId>
```

**Delete ALL collections (nuclear option):**
```bash
curl -s http://localhost:16333/collections | python3 -c "
import sys, json
for c in json.load(sys.stdin)['result']['collections']:
    print(c['name'])
" | while read name; do
  echo "Deleting $name"
  curl -s -X DELETE "http://localhost:16333/collections/$name" > /dev/null
done
```

**Wipe the entire Qdrant volume (most thorough):**
```bash
docker stop socraticode-qdrant
docker rm socraticode-qdrant
docker volume rm socraticode_qdrant_data
```

The server will recreate everything automatically on next use.
