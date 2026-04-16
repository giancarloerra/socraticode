# Changelog

All notable changes to SocratiCode are documented here.
This project uses [Conventional Commits](https://www.conventionalcommits.org/) and [Semantic Versioning](https://semver.org/).


## [1.6.0](https://github.com/giancarloerra/socraticode/compare/v1.5.0...v1.6.0) (2026-04-16)

### Features

* support global config fallback and configurable batch size ([9d04c44](https://github.com/giancarloerra/socraticode/commit/9d04c4443a7b0892548868fe04e59f9a35e43dcf))

### Bug Fixes

* resolve relative paths for global config fallback and strict batch size validation ([49b5b35](https://github.com/giancarloerra/socraticode/commit/49b5b35bff2809c17f1096cb62db7670503594aa))

### Documentation

* add CodeRabbit review expectations to PR template and contributing guide ([afd2da2](https://github.com/giancarloerra/socraticode/commit/afd2da2771e5ebe9cd81e391179adb769463ddb8))
* add Discord community, Cloud section, and tool portability to README ([a8b069a](https://github.com/giancarloerra/socraticode/commit/a8b069a900d5a4a20023b995ea0ecfe6b237cb7b))

## [1.5.0](https://github.com/giancarloerra/socraticode/compare/v1.4.1...v1.5.0) (2026-04-13)

### Features

* multi-platform plugin support (Cursor, Codex, Gemini CLI, VS Code) ([529d1b2](https://github.com/giancarloerra/socraticode/commit/529d1b2a642d9681ffce437cb2f902efa5aa7e6f))

### Bug Fixes

* correct spelling of "visualize" in GEMINI.md and update Codex installation instructions in README.md ([b2333b5](https://github.com/giancarloerra/socraticode/commit/b2333b574c3a978c6f3f5d6645e578b5d5bf03dc))

### Documentation

* consolidate README ([61060d5](https://github.com/giancarloerra/socraticode/commit/61060d51538a6f9fee550b7cda7f62ac47f07518))
* consolidate README — add feature comparison table and streamline sections ([efec8dd](https://github.com/giancarloerra/socraticode/commit/efec8dd29adb9da2c3308f1e3c470663c36773db))

## [1.4.1](https://github.com/giancarloerra/socraticode/compare/v1.4.0...v1.4.1) (2026-04-12)

### Bug Fixes

* address CodeRabbit PR review feedback ([00f7be1](https://github.com/giancarloerra/socraticode/commit/00f7be169c94661a098fff5e9354746823db1630))
* address CodeRabbit review findings ([bb5e6c3](https://github.com/giancarloerra/socraticode/commit/bb5e6c3e198effb1809d0a6c5286a34f8da0df68))

## [1.4.0](https://github.com/giancarloerra/socraticode/compare/v1.3.2...v1.4.0) (2026-04-12)

### Features

* branch-aware collection naming via SOCRATICODE_BRANCH_AWARE ([3a4139d](https://github.com/giancarloerra/socraticode/commit/3a4139d71426e7097a0b897db47dce99c5fac5b4)), closes [#19](https://github.com/giancarloerra/socraticode/issues/19)
* linked projects support via .socraticode.json and SOCRATICODE_LINKED_PROJECTS ([61e868c](https://github.com/giancarloerra/socraticode/commit/61e868cf9ef484cc83777d302094b10dd48ec5e3)), closes [#20](https://github.com/giancarloerra/socraticode/issues/20)
* multi-collection search with client-side RRF fusion and deduplication ([ad8db7f](https://github.com/giancarloerra/socraticode/commit/ad8db7f0db53bc0425e26282313706a8099fb792)), closes [#20](https://github.com/giancarloerra/socraticode/issues/20) [#19](https://github.com/giancarloerra/socraticode/issues/19) [#19](https://github.com/giancarloerra/socraticode/issues/19) [#20](https://github.com/giancarloerra/socraticode/issues/20)

### Bug Fixes

* address CodeRabbit review feedback on tests ([f09f417](https://github.com/giancarloerra/socraticode/commit/f09f417c6ec5446482b3fd7dc069b31435e7b81d))
* address remaining CodeRabbit production code issues ([f745d59](https://github.com/giancarloerra/socraticode/commit/f745d59ddd5baa722c49f2183bc2b922b630711d))
* linked projects use base hash without branch suffix ([fc3c298](https://github.com/giancarloerra/socraticode/commit/fc3c2988fa44c4441f2bddd209c4a55d1e4d8a1b))
* provide git identity for temp repo commits in CI ([ad2e3b9](https://github.com/giancarloerra/socraticode/commit/ad2e3b9ea16f24a39c7f0122c2388eaa4ca442a9))
* resolve JVM imports in multi-module Maven/Gradle projects ([5a734eb](https://github.com/giancarloerra/socraticode/commit/5a734eb301e9f9f53724be0da6818afa6927758f))
* update path handling and type imports in indexer and query tools ([096f59d](https://github.com/giancarloerra/socraticode/commit/096f59da130b155b435b291be85b212c78ae25fa))
* use self-contained temp git repos in branch-aware tests ([ffa8e95](https://github.com/giancarloerra/socraticode/commit/ffa8e95bdf00f2a245bbd181dec0ea5fbbec6804))

### Documentation

* add cross-project and branch-aware highlights to intro and Why SocratiCode ([24faa10](https://github.com/giancarloerra/socraticode/commit/24faa1075b77f88e63c785afb42c5bcd9538767d))
* add cross-project search and branch-aware indexing documentation ([76e3ff5](https://github.com/giancarloerra/socraticode/commit/76e3ff5f59720402bbbe07819ed69e6c93976f43))
* add OpenCode setup instructions to README ([0896164](https://github.com/giancarloerra/socraticode/commit/0896164442e340c234f37437cae11ebc65b139f5)), closes [#18](https://github.com/giancarloerra/socraticode/issues/18)

### Tests

* add includeLinked and searchMultipleCollections tests ([bf93e4a](https://github.com/giancarloerra/socraticode/commit/bf93e4a992ae39d2030a1452c60b8613e72b4d2e))

## [1.3.2](https://github.com/giancarloerra/socraticode/compare/v1.3.1...v1.3.2) (2026-03-26)

### Bug Fixes

* change SessionStart hook type from prompt to command ([72e4a5f](https://github.com/giancarloerra/socraticode/commit/72e4a5f9983b0169044af6bac411e909398559aa)), closes [#16](https://github.com/giancarloerra/socraticode/issues/16)

## [1.3.1](https://github.com/giancarloerra/socraticode/compare/v1.3.0...v1.3.1) (2026-03-24)

### Bug Fixes

* add prepublishOnly script to ensure dist/ is rebuilt before publish ([2f5b410](https://github.com/giancarloerra/socraticode/commit/2f5b410a04eb8be6e76a18e19dcfa0c169fdd144))

## [1.3.0](https://github.com/giancarloerra/socraticode/compare/v1.2.0...v1.3.0) (2026-03-19)

### Features

* add CSS [@import](https://github.com/import) tracking and path alias resolution to dependency graph ([c7e160c](https://github.com/giancarloerra/socraticode/commit/c7e160cb5ca0c5bd6e0ba9e2a258587c106fbab5))

### Bug Fixes

* add stylus to CSS resolution cases and getAstGrepLang mapping ([f80eec4](https://github.com/giancarloerra/socraticode/commit/f80eec476afc3c3979214ca2a331f08eb0cee0c8))

### Documentation

* update language support and graph docs for CSS [@import](https://github.com/import) and path aliases ([f4c5518](https://github.com/giancarloerra/socraticode/commit/f4c5518453afd3752ea4777419b5b04036ffd07d))

## [1.2.0](https://github.com/giancarloerra/socraticode/compare/v1.1.3...v1.2.0) (2026-03-18)

### Features

* add env support for controlling indexing of dotfiles ([7265247](https://github.com/giancarloerra/socraticode/commit/7265247d838b1792242a7ad082e6a35ec0759ce2))
* add Svelte and Vue import parsing to dependency graph ([4c2bd0c](https://github.com/giancarloerra/socraticode/commit/4c2bd0cc539e1fc170d019e073517b638ebbb294))
* auto-infer port from QDRANT_URL for reverse proxy support ([507d823](https://github.com/giancarloerra/socraticode/commit/507d823336a5340ea1c0bbba3b39acef9a1a35e0))

### Bug Fixes

* only call ensureOllamaReady when using Ollama provider ([#8](https://github.com/giancarloerra/socraticode/issues/8)) ([4d255f5](https://github.com/giancarloerra/socraticode/commit/4d255f50ee46e75aa2e1b23ef48e9809dc6b80d7)), closes [#7](https://github.com/giancarloerra/socraticode/issues/7)

### Documentation

* add npx cache update instructions for MCP-only install ([4cd113b](https://github.com/giancarloerra/socraticode/commit/4cd113b1e9e3776d127cd16545b9c048f353daf8))
* add Svelte/Vue to code graph language list ([7b72cf0](https://github.com/giancarloerra/socraticode/commit/7b72cf0363797ec7996e4b417abbfb538c6a1b78))

## [1.1.3](https://github.com/giancarloerra/socraticode/compare/v1.1.2...v1.1.3) (2026-03-16)

### Bug Fixes

* use relative paths for index keys to support shared worktree indexes ([505fbd7](https://github.com/giancarloerra/socraticode/commit/505fbd722bdb5cc310f7406df88a436e682a3b8b))

### Documentation

* add auto-update instructions for Claude Code plugin ([b26038a](https://github.com/giancarloerra/socraticode/commit/b26038a8b184fc63e7315d8d4a5cf0af3e37ae31))

## [1.1.2](https://github.com/giancarloerra/socraticode/compare/v1.1.1...v1.1.2) (2026-03-16)

### Bug Fixes

* correct hooks.json format, remove explicit hooks path, and improve install docs ([db69a2d](https://github.com/giancarloerra/socraticode/commit/db69a2d9b4e63324746741cf8b29931e81d652da))

## [1.1.1](https://github.com/giancarloerra/socraticode/compare/v1.1.0...v1.1.1) (2026-03-16)

### Bug Fixes

* correct Claude Code plugin install commands and add marketplace.json ([157b353](https://github.com/giancarloerra/socraticode/commit/157b353bc47e519a35561488967f01107de5b380))

## [1.1.0](https://github.com/giancarloerra/socraticode/compare/v1.0.1...v1.1.0) (2026-03-15)

### Features

* add Claude Code plugin with skills, agent, and MCP bundling ([31e5d74](https://github.com/giancarloerra/socraticode/commit/31e5d748bc65681686642e19252282a440785520))
* add SOCRATICODE_PROJECT_ID env var for shared indexes across directories ([fadfd8a](https://github.com/giancarloerra/socraticode/commit/fadfd8a80e6d33925fd071272a01d5132d7148cd))

### Documentation

* add Claude Code worktree auto-detection to git worktrees section ([d7c32d1](https://github.com/giancarloerra/socraticode/commit/d7c32d1435021172762531860350f38f83173edf))
* add git worktrees section to README ([3cad30a](https://github.com/giancarloerra/socraticode/commit/3cad30a6509837af2346fe6e83c7ec3aadc04900))
* add multi-agent collaboration as a featured capability ([72c7ce0](https://github.com/giancarloerra/socraticode/commit/72c7ce05f840b2870e83182ad83e4b0ee1938bef))

## [1.0.1](https://github.com/giancarloerra/socraticode/compare/v1.0.0...v1.0.1) (2026-03-04)

### Bug Fixes

* add mcpName and read version dynamically from package.json ([88c0e8f](https://github.com/giancarloerra/socraticode/commit/88c0e8fee39c7fb733bdec4657d2eaf2c355292e))
