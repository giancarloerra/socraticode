<p align="center">
  <img src="https://raw.githubusercontent.com/giancarloerra/socraticode/main/socraticode_logo.png" alt="SocratiCode" width="160">
</p>

<h1 align="center">SocratiCode</h1>

<p align="center"><strong>The codebase context engine for AI assistants.</strong><br>
Same understanding of your code, every assistant, every tool switch.</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=giancarloerra.socraticode"><img src="https://img.shields.io/visual-studio-marketplace/v/giancarloerra.socraticode?style=flat-square&logo=visualstudiocode&logoColor=white&label=VS%20Code%20Marketplace" alt="VS Code Marketplace"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=giancarloerra.socraticode"><img src="https://img.shields.io/visual-studio-marketplace/i/giancarloerra.socraticode?style=flat-square&label=installs" alt="Installs"></a>
  <a href="https://open-vsx.org/extension/giancarloerra/socraticode"><img src="https://img.shields.io/open-vsx/v/giancarloerra/socraticode?style=flat-square&label=Open%20VSX" alt="Open VSX"></a>
  <a href="https://open-vsx.org/extension/giancarloerra/socraticode"><img src="https://img.shields.io/open-vsx/dt/giancarloerra/socraticode?style=flat-square&label=downloads" alt="Open VSX Downloads"></a>
  <a href="https://github.com/giancarloerra/socraticode"><img src="https://img.shields.io/github/stars/giancarloerra/socraticode?style=flat-square&logo=github&label=stars" alt="GitHub stars"></a>
  <a href="https://discord.gg/5DrMXfNG"><img src="https://img.shields.io/badge/Discord-Join-5865F2?style=flat-square&logo=discord&logoColor=white" alt="Discord"></a>
  <a href="https://www.npmjs.com/package/socraticode"><img src="https://img.shields.io/npm/v/socraticode?style=flat-square&logo=npm&label=engine" alt="npm engine"></a>
  <a href="https://github.com/giancarloerra/socraticode/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue?style=flat-square" alt="License"></a>
</p>

<p align="center">
  <strong><a href="https://github.com/giancarloerra/socraticode#readme">Full documentation, configuration reference, and benchmarks on GitHub →</a></strong>
</p>

---

> **The big number.** On a 2.45M-line codebase, SocratiCode answers the same architectural question with **61% less context burned**, **84% fewer tool calls**, and **37x faster** than a grep-based AI agent. Same model, dramatically better answers. [Full benchmark on GitHub.](https://github.com/giancarloerra/socraticode#real-world-benchmark-vs-code-245m-lines-of-code-with-claude-opus-46)

This extension auto-registers the SocratiCode MCP server in any
MCP-compatible chat or agent in your editor, with no `mcp.json` editing
required.

## What it does

- **Hybrid search** (semantic + BM25, fused via Reciprocal Rank Fusion).
  Tested on codebases over 40 million lines.
- **File-level dependency graphs** across 18+ languages with circular-
  dependency detection.
- **Symbol-level call graph and impact analysis**: answers
  *"what breaks if I change function X?"* before the AI changes it.
- **Call-flow tracing** from any entry point, so onboarding to a
  legacy module takes minutes instead of days.
- **Cross-repo search** across linked workspaces. The bug is in the
  API gateway and the AI is looking at the front-end? It sees the
  full system in one query.
- **Interactive graph viewer** with blast-radius overlay, search,
  click-to-open-file, and PNG export. Opens directly inside the editor
  as a webview panel.
- **Context artefacts**: index database schemas, API specs and
  architecture docs alongside code. The AI sees the schema your team
  designed, not what it guessed from filenames.
- **Branch-aware indexing**: every branch gets its own index, so PR
  reviews see the code actually being reviewed.

## Built for real-world big teams and projects

- **Refactor safety on a monorepo.** Blast-radius analysis surfaces
  every file and symbol that calls into a target before any change
  goes in. Particularly useful in regulated and legacy contexts.
- **Multi-repo orgs.** Cross-project search treats your microservices
  as one searchable surface, not N disconnected repos.
- **Tool-independent.** Move from Cursor to Copilot to Cline to
  whatever ships next. The index, dependency graphs and context
  artefacts survive every tool switch. No vendor lock-in.
- **Air-gapped friendly.** The default deployment runs entirely on
  your machine via Docker (Qdrant + Ollama). Code never leaves the
  network unless you explicitly point at an external service via the
  `socraticode.env` setting.
- **Open source at the core (AGPL-3.0).** Battle-tested across thousands
  of repositories. Every component that touches your code is inspectable.
- **18+ languages out of the box.** TypeScript, JavaScript, Python, Go,
  Rust, Java, Kotlin, Scala, C#, C, C++, Ruby, PHP, Swift, Bash, Dart,
  Lua, Svelte, Vue, plus 35+ plain-text formats.

## Quick start

1. **Install the extension.** Search **SocratiCode** in your editor's
   Extensions panel. The MCP server registers automatically.
2. **Index the workspace.** Open the SocratiCode sidebar (Activity Bar
   icon) and click *Index this workspace*. The first index downloads
   the embedding model; subsequent updates are incremental.
3. **Ask anything.** Use your AI assistant: "where is auth handled?",
   "what breaks if I change `processOrder`?", "trace the nightly cron
   job", "what tables does this API touch?".
4. **Open the interactive graph.** Command Palette →
   `SocratiCode: Open interactive graph`.

A walkthrough is shown on first install; re-open it any time via
`SocratiCode: Open getting-started walkthrough`.

## Requirements

- An editor on the VS Code 1.99+ API (any of the editors listed above).
- Node.js 18+ on `PATH` (the engine launches via `npx`).
- Docker Desktop running (for the default local engine), OR a
  reachable external Qdrant if you'd rather not use Docker (configured
  via `socraticode.env`, see Settings).

## Commands

All commands appear under `SocratiCode:` in the Command Palette.

- `SocratiCode: Index current workspace`: kick off a one-time index.
- `SocratiCode: Open interactive graph`: render the dependency / call
  graph as an in-editor webview.
- `SocratiCode: Refresh indexed projects`: reload the sidebar tree.
- `SocratiCode: Open getting-started walkthrough`: replay the onboarding.
- `SocratiCode: Show output / logs`: open the SocratiCode output channel.

## Settings

| Setting | Default | Purpose |
|---|---|---|
| `socraticode.command` | `"npx"` | Engine launcher. |
| `socraticode.args` | `["-y", "socraticode"]` | Args for the launcher. |
| `socraticode.env` | `{}` | Environment variables forwarded to the engine. Use this to point at an external Qdrant cluster (`QDRANT_MODE=external`, `QDRANT_URL`, `QDRANT_API_KEY`), pick an embedding provider (`EMBEDDING_PROVIDER`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`), enable branch-aware indexing, link multiple projects, or set any other engine knob from the [engine README](https://github.com/giancarloerra/socraticode#configuration). |
| `socraticode.statusBar` | `true` | Show the status-bar item. |

## Compatibility

**Editors.** This extension installs in any editor that supports the
VS Code 1.99+ extension API:

- Microsoft VS Code (Stable / Insiders)
- Cursor
- VSCodium
- Gitpod
- code-server
- Eclipse Theia-based editors
- Google Antigravity
- Particle Workbench

**AI surfaces.** The MCP server registered by this extension is
discovered automatically by any MCP-compatible chat or agent installed
in your editor:

- GitHub Copilot agent mode
- Cursor's Agent / Composer
- The Gemini chat surface in Antigravity
- [Cline](https://github.com/cline/cline)
- [Continue](https://www.continue.dev/)
- [Roo Code](https://roo.tech/)
- Any other MCP-aware client, including ones not listed here

If your editor or AI surface speaks MCP, SocratiCode shows up.

## SocratiCode Cloud (private beta)

The same engine, hosted by us. Adds managed infrastructure (no Docker
or Qdrant or Ollama on your machine), webhook-driven auto-indexing on
every push and every branch, shared team indexes across your whole
organisation, SSO/SAML, audit logs, and SOC 2 / ISO 27001-aligned
controls. Currently in private beta.

[Request access at socraticode.cloud →](https://socraticode.cloud)

## Privacy and data

- The engine indexes locally by default. Code never leaves your
  machine unless you explicitly configure an external service via
  `socraticode.env`.
- No telemetry from the extension.
- The engine is open source under AGPL-3.0; every component that
  touches your code is inspectable.

## Learn more

The extension is the install surface. The full picture lives in the
project repo:

- **[Full README, configuration reference, and benchmark methodology](https://github.com/giancarloerra/socraticode#readme)**
- [Issues and feature requests](https://github.com/giancarloerra/socraticode/issues)
- [Discord community](https://discord.gg/5DrMXfNG)

## Troubleshooting

- **"Cannot find Docker"**: install Docker Desktop from
  https://docker.com/products/docker-desktop, or set `socraticode.env`
  with `QDRANT_MODE=external` plus `QDRANT_URL` to use an existing
  Qdrant instance.
- **MCP tools don't appear in your assistant**: restart the chat after
  install, or run `MCP: List Servers` from the command palette and
  confirm `SocratiCode` is listed and started.
- **First index is slow**: the engine downloads the embedding model
  the first time. Subsequent runs are fast.
- **Anything else**: `SocratiCode: Show output / logs` from the
  command palette has the engine output.

## License

[AGPL-3.0-only](https://github.com/giancarloerra/socraticode/blob/main/LICENSE).
The engine and this extension are open source.
