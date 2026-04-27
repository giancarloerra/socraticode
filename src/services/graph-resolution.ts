// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited
import { readFileSync } from "node:fs";
import path from "node:path";
import type { PathAliases } from "./graph-aliases.js";

// ── Module resolution ────────────────────────────────────────────────────

/**
 * Build a suffix lookup map for JVM (Java/Kotlin/Scala) files in multi-module projects.
 *
 * For a Maven/Gradle multi-module layout such as:
 *   module-a/sub-module/src/main/java/com/example/Foo.java
 * the map entry is:
 *   key:   "com/example/Foo.java"  (platform-normalised with path.sep)
 *   value: "module-a/sub-module/src/main/java/com/example/Foo.java"
 *
 * This enables O(1) resolution of fully-qualified class names that cannot be
 * found via the standard prefix-based scan (e.g. src/main/java/…).
 *
 * Call this once per graph build and pass the result to resolveImport.
 */
export function buildJvmSuffixMap(fileSet: Set<string>): Map<string, string> {
  const map = new Map<string, string>();
  const jvmExts = new Set([".java", ".kt", ".kts", ".scala"]);

  for (const f of fileSet) {
    if (!jvmExts.has(path.extname(f))) continue;

    // Split on either separator so the logic works on Windows and POSIX.
    const parts = f.split(/[\\/]/);

    // Find the first occurrence of src/main/<lang> boundary.
    const jvmLangs = new Set(["java", "kotlin", "scala"]);
    const idx = parts.findIndex(
      (p, i) =>
        p === "src" &&
        parts[i + 1] === "main" &&
        jvmLangs.has(parts[i + 2]),
    );

    if (idx !== -1) {
      // classPath = everything after src/main/<lang>, e.g. com/example/Foo.java
      const classPath = parts.slice(idx + 3).join(path.sep);
      // Only register the first match to avoid ambiguity for duplicate class names.
      if (!map.has(classPath)) {
        map.set(classPath, f);
      }
    }
  }

  return map;
}

/**
 * Build a namespace lookup map for C# files.
 *
 * Scans every `.cs` file in the project for `namespace X.Y.Z` declarations
 * (both block-scoped `namespace X { ... }` and file-scoped `namespace X;`
 * introduced in C# 10) and builds:
 *
 *   key:   "App.Services"
 *   value: ["src/Services/OrderService.cs", "src/Services/UserService.cs"]
 *
 * Used to resolve `using App.Services;` to the candidate files that
 * contribute to that namespace. Without this, every C# `using` resolved
 * to `null` and C# projects produced an empty file-import graph.
 *
 * Files are processed in lexicographic order so the resulting candidate
 * lists are deterministic across machines and runs. This matters because
 * multi-file namespaces resolve to `candidates[0]` in `resolveImport`,
 * and a stable "first" file is required for reproducible graphs.
 *
 * Cost: O(n) reads at graph-build time (negligible vs. AST parsing). Files
 * with no `namespace` declaration are silently skipped. Read failures are
 * swallowed since this is best-effort.
 */
export function buildCsNamespaceMap(
  fileSet: Set<string>,
  projectPath: string,
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  // Match both `namespace Foo.Bar { ... }` and the file-scoped C# 10+
  // syntax `namespace Foo.Bar;`. The `^\s*` lets us catch nested
  // declarations (`namespace Outer { namespace Inner { ... } }`) which
  // are indented inside the outer block. The dotted-identifier capture
  // requires each segment to start with a letter or underscore (matching
  // C# identifier rules) so junk like `namespace 1Foo` is rejected. The
  // `(?=[;{])` lookahead ensures we only match real declarations and
  // not stray occurrences of the word `namespace`.
  const namespaceRegex =
    /^\s*namespace\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*(?=[;{])/gm;

  // `fileSet` reflects fs.readdir() traversal order, which POSIX does not
  // guarantee. Sort .cs paths lexically so candidate lists are stable.
  const csFiles = [...fileSet]
    .filter((f) => path.extname(f).toLowerCase() === ".cs")
    .sort();

  for (const f of csFiles) {
    let source: string;
    try {
      source = readFileSync(path.join(projectPath, f), "utf-8");
    } catch {
      continue;
    }
    for (const match of source.matchAll(namespaceRegex)) {
      const ns = match[1];
      const existing = map.get(ns);
      if (existing) {
        if (!existing.includes(f)) existing.push(f);
      } else {
        map.set(ns, [f]);
      }
    }
  }

  return map;
}

/**
 * Resolve a module specifier to a relative file path within the project.
 * Returns null if the module is external (e.g., npm package, stdlib).
 */
export function resolveImport(
  moduleSpecifier: string,
  sourceFile: string,
  projectPath: string,
  fileSet: Set<string>,
  language: string,
  aliases?: PathAliases,
  jvmSuffixMap?: Map<string, string>,
  csNamespaceMap?: Map<string, string[]>,
): string | null {
  // Skip obvious external/stdlib modules
  if (isExternalModule(moduleSpecifier, language)) return null;

  const sourceDir = path.dirname(sourceFile);

  switch (language) {
    case "javascript":
    case "typescript":
    case "svelte":
    case "vue": {
      const jsExtensions = [".svelte", ".vue", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
      // Relative imports: ./foo, ../bar
      if (moduleSpecifier.startsWith(".")) {
        return resolveRelativePath(moduleSpecifier, sourceDir, projectPath, fileSet, jsExtensions);
      }
      // Try path alias resolution
      return resolveAliasPath(moduleSpecifier, projectPath, fileSet, jsExtensions, aliases);
    }

    case "css":
    case "scss":
    case "sass":
    case "less":
    case "stylus": {
      const cssExtensions = [".css", ".scss", ".sass", ".less", ".styl"];
      // CSS @import: ./variables.css, ../mixins.scss
      if (moduleSpecifier.startsWith(".")) {
        return resolveRelativePath(moduleSpecifier, sourceDir, projectPath, fileSet, cssExtensions);
      }
      // Try path alias resolution (e.g., $lib/styles/vars.css)
      return resolveAliasPath(moduleSpecifier, projectPath, fileSet, cssExtensions, aliases);
    }

    case "python": {
      // Relative: .foo, ..bar
      if (moduleSpecifier.startsWith(".")) {
        const dots = moduleSpecifier.match(/^\.+/)?.[0].length ?? 0;
        let baseDir = sourceDir;
        for (let i = 1; i < dots; i++) {
          baseDir = path.dirname(baseDir);
        }
        const rest = moduleSpecifier.slice(dots).replace(/\./g, "/");
        return resolveRelativePath(rest || ".", baseDir, projectPath, fileSet, [".py"]);
      }
      // Absolute: foo.bar.baz → foo/bar/baz.py or foo/bar/baz/__init__.py
      const modulePath = moduleSpecifier.replace(/\./g, "/");
      const direct = resolveRelativePath(modulePath, projectPath, projectPath, fileSet, [".py"]);
      if (direct) return direct;

      // Try common Python source directories (src layout)
      const pySrcDirs = ["src", "lib"];
      for (const dir of pySrcDirs) {
        const inSrc = resolveRelativePath(
          path.join(dir, modulePath), projectPath, projectPath, fileSet, [".py"],
        );
        if (inSrc) return inSrc;
      }
      return null;
    }

    case "go": {
      // Go imports are package paths; only track if it looks like a local module
      // (contains the module name or starts with ./)
      return null; // Go resolution requires go.mod analysis
    }

    case "java":
    case "kotlin":
    case "scala": {
      // com.example.Foo → com/example/Foo.java (or .kt, .scala)
      const filePath = moduleSpecifier.replace(/\./g, "/");
      const exts = language === "java" ? [".java"] : language === "kotlin" ? [".kt", ".kts"] : [".scala"];

      // 1. Try direct resolution from project root (single-module layout).
      const direct = resolveRelativePath(filePath, projectPath, projectPath, fileSet, exts);
      if (direct) return direct;

      // 2. Try common source directories (Maven/Gradle single-module convention).
      const jvmSrcDirs = [
        `src/main/${language}`,  // src/main/java, src/main/kotlin, src/main/scala
        "src/main",
        "src",
      ];
      for (const dir of jvmSrcDirs) {
        const inSrc = resolveRelativePath(
          path.join(dir, filePath), projectPath, projectPath, fileSet, exts,
        );
        if (inSrc) return inSrc;
      }

      // 3. Fallback: suffix-map lookup for multi-module Maven/Gradle projects.
      //    e.g. module-a/sub/src/main/java/com/example/Foo.java
      //    The map is built once per graph build (O(n)) and looked up in O(1).
      if (jvmSuffixMap) {
        for (const ext of exts) {
          const classPath = filePath.replace(/\//g, path.sep) + ext;
          const found = jvmSuffixMap.get(classPath);
          if (found) return found;
        }
      }

      return null;
    }

    case "c":
    case "cpp": {
      // #include "relative/path.h"
      return resolveRelativePath(moduleSpecifier, sourceDir, projectPath, fileSet, []);
    }

    case "ruby": {
      if (moduleSpecifier.startsWith("./") || moduleSpecifier.startsWith("../")) {
        return resolveRelativePath(moduleSpecifier, sourceDir, projectPath, fileSet, [".rb"]);
      }
      return resolveRelativePath(moduleSpecifier, projectPath, projectPath, fileSet, [".rb"]);
    }

    case "php": {
      // PSR-4: App\Models\User → app/Models/User.php
      if (moduleSpecifier.includes("\\")) {
        const filePath = moduleSpecifier.replace(/\\/g, "/");
        // Try exact case first
        const exact = resolveRelativePath(filePath, projectPath, projectPath, fileSet, [".php"]);
        if (exact) return exact;

        // PSR-4 convention: lowercase first segment (App → app)
        const segments = filePath.split("/");
        if (segments.length > 1) {
          segments[0] = segments[0].toLowerCase();
          const lowered = segments.join("/");
          const loweredResult = resolveRelativePath(lowered, projectPath, projectPath, fileSet, [".php"]);
          if (loweredResult) return loweredResult;
        }

        // Try common Composer src directories (namespace root → src/ or lib/)
        const srcDirs = ["src", "lib"];
        for (const dir of srcDirs) {
          // Skip first segment (namespace root) and look under src/
          const withoutRoot = segments.slice(1).join("/");
          if (withoutRoot) {
            const inSrc = resolveRelativePath(
              path.join(dir, withoutRoot), projectPath, projectPath, fileSet, [".php"],
            );
            if (inSrc) return inSrc;
          }
        }

        return null;
      }
      if (moduleSpecifier.startsWith("./") || moduleSpecifier.startsWith("../")) {
        return resolveRelativePath(moduleSpecifier, sourceDir, projectPath, fileSet, [".php"]);
      }
      return null;
    }

    case "rust": {
      // mod foo → foo.rs or foo/mod.rs
      if (!moduleSpecifier.includes("::")) {
        const candidates = [
          path.join(sourceDir, `${moduleSpecifier}.rs`),
          path.join(sourceDir, moduleSpecifier, "mod.rs"),
        ];
        for (const candidate of candidates) {
          const rel = path.relative(projectPath, candidate);
          if (fileSet.has(rel)) return rel;
        }
      }
      return null;
    }

    case "csharp": {
      // C# `using X.Y.Z;` resolves via a namespace lookup map built once
      // at graph-build time. Project-internal namespaces map to one or
      // more files (multi-file namespaces are common in real .NET
      // projects). External namespaces (`System.*`, `Microsoft.*`, etc.)
      // are filtered earlier by `isExternalModule`.
      //
      // When a namespace spans multiple files we return the first
      // candidate as the resolved dependency. This produces meaningful
      // edges instead of the previous always-null behaviour, which left
      // C# file graphs empty and silently degraded the symbol-level
      // tools' cross-file resolution. A multi-file fan-out improvement
      // is tracked as a follow-up.
      if (csNamespaceMap) {
        const candidates = csNamespaceMap.get(moduleSpecifier);
        if (candidates && candidates.length > 0) {
          return candidates[0];
        }
      }
      return null;
    }

    case "swift": {
      if (moduleSpecifier.startsWith("./") || moduleSpecifier.startsWith("../")) {
        return resolveRelativePath(moduleSpecifier, sourceDir, projectPath, fileSet, [".swift"]);
      }
      return null;
    }

    case "bash": {
      // source ./script.sh
      if (moduleSpecifier.startsWith("./") || moduleSpecifier.startsWith("../")) {
        return resolveRelativePath(moduleSpecifier, sourceDir, projectPath, fileSet, [".sh", ".bash"]);
      }
      return null;
    }

    case "dart": {
      // package:foo/bar.dart → external; relative paths only
      if (moduleSpecifier.startsWith("package:")) return null;
      if (moduleSpecifier.startsWith("dart:")) return null;
      return resolveRelativePath(moduleSpecifier, sourceDir, projectPath, fileSet, [".dart"]);
    }

    case "lua": {
      // require("foo.bar") → foo/bar.lua
      const luaPath = moduleSpecifier.replace(/\./g, "/");
      return resolveRelativePath(luaPath, projectPath, projectPath, fileSet, [".lua"]);
    }

    default:
      return null;
  }
}

/** Check if a module specifier refers to an external/stdlib module */
function isExternalModule(spec: string, language: string): boolean {
  switch (language) {
    case "python":
      // Common stdlib modules
      return ["os", "sys", "re", "json", "math", "datetime", "collections",
              "typing", "pathlib", "io", "functools", "itertools", "abc",
              "asyncio", "unittest", "logging", "argparse", "subprocess",
              "socket", "http", "urllib", "hashlib", "copy", "enum",
              "dataclasses", "contextlib", "textwrap", "string", "struct",
              "time", "threading", "multiprocessing", "xml", "csv",
              "sqlite3", "pickle", "shelve", "tempfile", "shutil", "glob",
             ].includes(spec.split(".")[0]);
    case "go":
      return !spec.includes("/") || spec.startsWith("golang.org/") || !spec.includes(".");
    case "java":
    case "kotlin":
    case "scala":
      return spec.startsWith("java.") || spec.startsWith("javax.") ||
             spec.startsWith("kotlin.") || spec.startsWith("kotlinx.") ||
             spec.startsWith("scala.") || spec.startsWith("android.");
    case "csharp":
      return spec.startsWith("System.") || spec === "System" ||
             spec.startsWith("Microsoft.");
    case "rust":
      return spec.startsWith("std::") || spec.startsWith("core::") || spec.startsWith("alloc::");
    case "swift":
      return ["Foundation", "UIKit", "SwiftUI", "Combine", "CoreData",
              "CoreGraphics", "CoreLocation", "MapKit", "XCTest"].includes(spec);
    case "php":
      return false; // PHP doesn't have stdlib imports in the same way
    case "ruby":
      return !spec.startsWith("./") && !spec.startsWith("../") && !spec.includes("/");
    case "dart":
      return spec.startsWith("dart:") || spec.startsWith("package:");
    case "lua":
      // Common Lua stdlib/C modules
      return ["string", "table", "math", "io", "os", "coroutine",
              "debug", "package", "utf8", "bit32"].includes(spec.split(".")[0]);
    default:
      return false;
  }
}

/** Try resolving a module specifier via path aliases (tsconfig/jsconfig paths) */
function resolveAliasPath(
  moduleSpecifier: string,
  projectPath: string,
  fileSet: Set<string>,
  extensions: string[],
  aliases?: PathAliases,
): string | null {
  if (!aliases?.entries) return null;
  for (const [prefix, targets] of aliases.entries) {
    // Wildcard aliases end with "/" (from "$lib/*") — match as prefix
    // Exact aliases (no trailing "/") — match only the exact specifier
    const isWildcard = prefix.endsWith("/");
    const matches = isWildcard
      ? moduleSpecifier.startsWith(prefix)
      : moduleSpecifier === prefix;

    if (matches) {
      const rest = moduleSpecifier.slice(prefix.length);
      for (const target of targets) {
        const resolved = resolveRelativePath(
          path.join(target, rest), projectPath, projectPath, fileSet, extensions,
        );
        if (resolved) return resolved;
      }
    }
  }
  return null;
}

/** Resolve a potentially extensionless path to an actual file */
function resolveRelativePath(
  modulePath: string,
  baseDir: string,
  projectPath: string,
  fileSet: Set<string>,
  extensions: string[],
): string | null {
  const fullPath = path.resolve(baseDir, modulePath);
  const relPath = path.relative(projectPath, fullPath);

  // Direct match
  if (fileSet.has(relPath)) return relPath;

  // Try with extensions appended (for extensionless imports)
  for (const ext of extensions) {
    const withExt = relPath + ext;
    if (fileSet.has(withExt)) return withExt;
  }

  // Handle TypeScript .js→.ts extension mapping:
  // When a TS file imports "./foo.js", the actual file is "./foo.ts"
  const existingExt = path.extname(relPath);
  if (existingExt && extensions.length > 0) {
    const baseName = relPath.slice(0, -existingExt.length);
    for (const ext of extensions) {
      if (ext !== existingExt) {
        const swapped = baseName + ext;
        if (fileSet.has(swapped)) return swapped;
      }
    }
  }

  // Try as directory with index file
  for (const ext of extensions) {
    const indexFile = path.join(relPath, `index${ext}`);
    if (fileSet.has(indexFile)) return indexFile;
  }

  // SCSS/Sass partial: @import "variables" → _variables.scss
  if (extensions.some((e) => [".scss", ".sass", ".less", ".styl"].includes(e))) {
    const dir = path.dirname(relPath);
    const base = path.basename(relPath);
    if (!base.startsWith("_")) {
      // Try _name (direct)
      const partial = path.join(dir, `_${base}`);
      if (fileSet.has(partial)) return partial;
      // Try _name with extensions
      for (const ext of extensions) {
        const partialExt = path.join(dir, `_${base}${ext}`);
        if (fileSet.has(partialExt)) return partialExt;
      }
    }
  }

  // Python: try __init__.py
  if (extensions.includes(".py")) {
    const initFile = path.join(relPath, "__init__.py");
    if (fileSet.has(initFile)) return initFile;
  }

  return null;
}
