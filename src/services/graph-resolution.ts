// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited
import path from "node:path";

// ── Module resolution ────────────────────────────────────────────────────

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
): string | null {
  // Skip obvious external/stdlib modules
  if (isExternalModule(moduleSpecifier, language)) return null;

  const sourceDir = path.dirname(sourceFile);

  switch (language) {
    case "javascript":
    case "typescript":
    case "svelte":
    case "vue": {
      // Relative imports: ./foo, ../bar
      if (moduleSpecifier.startsWith(".")) {
        return resolveRelativePath(moduleSpecifier, sourceDir, projectPath, fileSet, [
          ".svelte", ".vue", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
        ]);
      }
      return null; // npm packages
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
      // Try direct resolution from project root
      const direct = resolveRelativePath(filePath, projectPath, projectPath, fileSet, exts);
      if (direct) return direct;

      // Try common source directories (Maven/Gradle convention)
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
      // Namespaces don't map cleanly to files, skip
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

  // Python: try __init__.py
  if (extensions.includes(".py")) {
    const initFile = path.join(relPath, "__init__.py");
    if (fileSet.has(initFile)) return initFile;
  }

  return null;
}
