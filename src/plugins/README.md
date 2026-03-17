# SocratiCode Plugins

Plugins extend SocratiCode's indexer with custom behavior. They are auto-discovered at startup — no core code changes needed.

## Creating a Plugin

1. Create a folder: `src/plugins/<your-plugin>/`
2. Add an `index.ts` entry point that registers with the plugin manager:

```typescript
import { pluginManager } from "../../services/plugin.js";
import type { SocratiCodePlugin } from "../../services/plugin.js";

const myPlugin: SocratiCodePlugin = {
  name: "my-plugin",
  async onProjectIndexed(projectPath, onProgress) { /* ... */ },
  async onProjectUpdated(projectPath, onProgress) { /* ... */ },
  async onProjectRemoved(projectPath) { /* ... */ },
  async onShutdown() { /* ... */ },
};

pluginManager.register(myPlugin);
```

3. That's it — `pluginManager.load()` discovers and loads it automatically.

## Plugin Structure

```
src/plugins/<name>/
├── index.ts              # Entry point (required)
├── types.ts              # Plugin-specific types
├── __tests__/            # Co-located tests
│   ├── unit/             # Pure function tests (no external deps)
│   ├── integration/      # Tests requiring Qdrant, Docker, etc.
│   └── e2e/              # Full workflow tests
├── docs/                 # Documentation
│   └── README.md
└── *.ts                  # Implementation files
```

## Plugin Interface

All hooks are optional. Errors are non-fatal (logged, never crash the indexer).

| Hook | When | Args |
|------|------|------|
| `onProjectIndexed` | After full index | `projectPath`, `onProgress?` |
| `onProjectUpdated` | After incremental update | `projectPath`, `onProgress?` |
| `onProjectRemoved` | After index removal | `projectPath` |
| `onShutdown` | Graceful shutdown | — |
