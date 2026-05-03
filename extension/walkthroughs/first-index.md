# Index your first project

Index the workspace:

1. Open the SocratiCode sidebar (Activity Bar → SocratiCode icon).
2. Click **Index this workspace** in the welcome view, or run **SocratiCode:
   Index current workspace** from the command palette.

The first index downloads the embedding model if it's not already cached
(the default is `nomic-embed-text` via the local Docker Ollama, a few
hundred megabytes), then walks the workspace. Subsequent updates are
incremental and triggered automatically when files change.

## What gets indexed

- All source files in 18+ languages (TypeScript, JavaScript, Python, Go,
  Rust, Java, Kotlin, Scala, C#, C, C++, Ruby, PHP, Swift, Bash, Dart, Lua,
  Svelte, Vue, plus 35+ plain-text formats).
- Files matching `EXTRA_EXTENSIONS` (configurable).
- Context artefacts declared in `.socraticodecontextartifacts.json` if
  present (database schemas, API specs, infra configs, architecture docs).

## What gets skipped

- Anything in `.gitignore` (unless `RESPECT_GITIGNORE` is `false`).
- Files larger than `MAX_FILE_SIZE_MB` (default 5 MB).
- Dot directories like `.git`, `.next` (unless `INCLUDE_DOT_FILES` is `true`).

## Requirements

The local engine spins up Docker containers for Qdrant (vector database)
and Ollama (embeddings) on first use. Make sure Docker Desktop is running.

## Advanced configuration

Need to point at an existing Qdrant cluster, use OpenAI or Google
embeddings, change ports or paths? The engine reads these from environment
variables. Set them via the `socraticode.env` setting (Settings UI or
`settings.json`):

```json
"socraticode.env": {
  "QDRANT_MODE": "external",
  "QDRANT_URL": "https://your-cluster.example",
  "QDRANT_API_KEY": "...",
  "EMBEDDING_PROVIDER": "openai",
  "OPENAI_API_KEY": "..."
}
```

See the [engine README](https://github.com/giancarloerra/socraticode#configuration)
for the full list.
