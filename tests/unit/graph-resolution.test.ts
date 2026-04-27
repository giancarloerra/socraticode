// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildCsNamespaceMap,
  buildJvmSuffixMap,
  resolveImport,
} from "../../src/services/graph-resolution.js";

// ── Helper to create temp project layouts ─────────────────────────────

interface TempProject {
  root: string;
  fileSet: Set<string>;
  cleanup: () => void;
}

function createTempProject(
  files: Record<string, string>,
): TempProject {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "socraticode-resolve-"));
  const fileSet = new Set<string>();

  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = path.join(root, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
    fileSet.add(relPath);
  }

  return {
    root,
    fileSet,
    cleanup: () => {
      try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
    },
  };
}

describe("graph-resolution", () => {
  let project: TempProject | null = null;

  afterEach(() => {
    project?.cleanup();
    project = null;
  });

  describe("TypeScript/JavaScript resolution", () => {
    it("resolves relative imports with .js extension to .ts files", () => {
      project = createTempProject({
        "src/index.ts": "",
        "src/utils.ts": "",
      });

      const result = resolveImport(
        "./utils.js",
        path.join(project.root, "src/index.ts"),
        project.root,
        project.fileSet,
        "typescript",
      );

      expect(result).toBe("src/utils.ts");
    });

    it("resolves relative imports without extension", () => {
      project = createTempProject({
        "src/index.ts": "",
        "src/helpers.ts": "",
      });

      const result = resolveImport(
        "./helpers",
        path.join(project.root, "src/index.ts"),
        project.root,
        project.fileSet,
        "typescript",
      );

      expect(result).toBe("src/helpers.ts");
    });

    it("resolves imports to index files", () => {
      project = createTempProject({
        "src/app.ts": "",
        "src/utils/index.ts": "",
      });

      const result = resolveImport(
        "./utils",
        path.join(project.root, "src/app.ts"),
        project.root,
        project.fileSet,
        "typescript",
      );

      expect(result).toBe("src/utils/index.ts");
    });

    it("resolves parent directory imports", () => {
      project = createTempProject({
        "src/utils/helper.ts": "",
        "src/types.ts": "",
      });

      const result = resolveImport(
        "../types",
        path.join(project.root, "src/utils/helper.ts"),
        project.root,
        project.fileSet,
        "typescript",
      );

      expect(result).toBe("src/types.ts");
    });

    it("returns null for npm package imports", () => {
      project = createTempProject({
        "src/index.ts": "",
      });

      const result = resolveImport(
        "lodash",
        path.join(project.root, "src/index.ts"),
        project.root,
        project.fileSet,
        "typescript",
      );

      expect(result).toBeNull();
    });

    it("returns null for npm scoped package imports", () => {
      project = createTempProject({
        "src/index.ts": "",
      });

      const result = resolveImport(
        "@types/node",
        path.join(project.root, "src/index.ts"),
        project.root,
        project.fileSet,
        "typescript",
      );

      expect(result).toBeNull();
    });

    it("resolves direct .ts file imports", () => {
      project = createTempProject({
        "src/index.ts": "",
        "src/config.ts": "",
      });

      const result = resolveImport(
        "./config.ts",
        path.join(project.root, "src/index.ts"),
        project.root,
        project.fileSet,
        "typescript",
      );

      expect(result).toBe("src/config.ts");
    });
  });

  describe("Python resolution", () => {
    it("resolves relative imports", () => {
      project = createTempProject({
        "src/main.py": "",
        "src/models.py": "",
      });

      const result = resolveImport(
        ".models",
        path.join(project.root, "src/main.py"),
        project.root,
        project.fileSet,
        "python",
      );

      expect(result).toBe("src/models.py");
    });

    it("resolves absolute package imports", () => {
      project = createTempProject({
        "app.py": "",
        "utils/helpers.py": "",
      });

      const result = resolveImport(
        "utils.helpers",
        path.join(project.root, "app.py"),
        project.root,
        project.fileSet,
        "python",
      );

      expect(result).toBe("utils/helpers.py");
    });

    it("resolves __init__.py for package imports", () => {
      project = createTempProject({
        "app.py": "",
        "utils/__init__.py": "",
      });

      const result = resolveImport(
        "utils",
        path.join(project.root, "app.py"),
        project.root,
        project.fileSet,
        "python",
      );

      expect(result).toBe("utils/__init__.py");
    });

    it("returns null for stdlib imports", () => {
      project = createTempProject({
        "app.py": "",
      });

      const result = resolveImport(
        "os",
        path.join(project.root, "app.py"),
        project.root,
        project.fileSet,
        "python",
      );

      expect(result).toBeNull();
    });

    it("returns null for json stdlib", () => {
      project = createTempProject({
        "app.py": "",
      });

      const result = resolveImport(
        "json",
        path.join(project.root, "app.py"),
        project.root,
        project.fileSet,
        "python",
      );

      expect(result).toBeNull();
    });

    it("resolves absolute imports under src/ directory (src layout)", () => {
      project = createTempProject({
        "app.py": "",
        "src/mypackage/utils.py": "",
      });

      const result = resolveImport(
        "mypackage.utils",
        path.join(project.root, "app.py"),
        project.root,
        project.fileSet,
        "python",
      );

      expect(result).toBe("src/mypackage/utils.py");
    });
  });

  describe("Rust resolution", () => {
    it("resolves mod declarations to .rs files", () => {
      project = createTempProject({
        "src/main.rs": "",
        "src/config.rs": "",
      });

      const result = resolveImport(
        "config",
        path.join(project.root, "src/main.rs"),
        project.root,
        project.fileSet,
        "rust",
      );

      expect(result).toBe("src/config.rs");
    });

    it("resolves mod declarations to mod.rs", () => {
      project = createTempProject({
        "src/main.rs": "",
        "src/utils/mod.rs": "",
      });

      const result = resolveImport(
        "utils",
        path.join(project.root, "src/main.rs"),
        project.root,
        project.fileSet,
        "rust",
      );

      expect(result).toBe("src/utils/mod.rs");
    });

    it("returns null for std:: imports", () => {
      project = createTempProject({
        "src/main.rs": "",
      });

      const result = resolveImport(
        "std::collections::HashMap",
        path.join(project.root, "src/main.rs"),
        project.root,
        project.fileSet,
        "rust",
      );

      expect(result).toBeNull();
    });
  });

  describe("C/C++ resolution", () => {
    it("resolves relative header includes", () => {
      project = createTempProject({
        "src/main.c": "",
        "src/utils.h": "",
      });

      const result = resolveImport(
        "utils.h",
        path.join(project.root, "src/main.c"),
        project.root,
        project.fileSet,
        "c",
      );

      expect(result).toBe("src/utils.h");
    });

    it("resolves parent directory includes", () => {
      project = createTempProject({
        "src/sub/app.c": "",
        "src/common.h": "",
      });

      const result = resolveImport(
        "../common.h",
        path.join(project.root, "src/sub/app.c"),
        project.root,
        project.fileSet,
        "c",
      );

      expect(result).toBe("src/common.h");
    });
  });

  describe("Ruby resolution", () => {
    it("resolves relative requires", () => {
      project = createTempProject({
        "lib/app.rb": "",
        "lib/models/user.rb": "",
      });

      const result = resolveImport(
        "./models/user",
        path.join(project.root, "lib/app.rb"),
        project.root,
        project.fileSet,
        "ruby",
      );

      expect(result).toBe("lib/models/user.rb");
    });
  });

  describe("PHP resolution", () => {
    it("resolves PSR-4 namespace with lowercase first segment (Laravel convention)", () => {
      project = createTempProject({
        "app/Models/User.php": "",
        "app/Http/Controllers/UserController.php": "",
      });

      const result = resolveImport(
        "App\\Models\\User",
        path.join(project.root, "app/Http/Controllers/UserController.php"),
        project.root,
        project.fileSet,
        "php",
      );

      expect(result).toBe("app/Models/User.php");
    });

    it("resolves PSR-4 namespace with exact case match", () => {
      project = createTempProject({
        "App/Models/User.php": "",
      });

      const result = resolveImport(
        "App\\Models\\User",
        path.join(project.root, "index.php"),
        project.root,
        project.fileSet,
        "php",
      );

      expect(result).toBe("App/Models/User.php");
    });

    it("resolves relative require paths", () => {
      project = createTempProject({
        "config.php": "",
        "bootstrap/app.php": "",
      });

      const result = resolveImport(
        "../config.php",
        path.join(project.root, "bootstrap/app.php"),
        project.root,
        project.fileSet,
        "php",
      );

      expect(result).toBe("config.php");
    });

    it("returns null for unresolvable vendor namespaces", () => {
      project = createTempProject({
        "app/Http/Controllers/UserController.php": "",
      });

      const result = resolveImport(
        "Illuminate\\Http\\Request",
        path.join(project.root, "app/Http/Controllers/UserController.php"),
        project.root,
        project.fileSet,
        "php",
      );

      expect(result).toBeNull();
    });

    it("resolves namespace to src directory", () => {
      project = createTempProject({
        "src/Models/User.php": "",
        "index.php": "",
      });

      const result = resolveImport(
        "MyPackage\\Models\\User",
        path.join(project.root, "index.php"),
        project.root,
        project.fileSet,
        "php",
      );

      expect(result).toBe("src/Models/User.php");
    });
  });

  describe("Java resolution", () => {
    it("resolves fully qualified class imports", () => {
      project = createTempProject({
        "src/App.java": "",
        "com/example/models/User.java": "",
      });

      const result = resolveImport(
        "com.example.models.User",
        path.join(project.root, "src/App.java"),
        project.root,
        project.fileSet,
        "java",
      );

      expect(result).toBe("com/example/models/User.java");
    });

    it("resolves imports under src/main/java (Maven convention)", () => {
      project = createTempProject({
        "src/main/java/com/example/App.java": "",
        "src/main/java/com/example/models/User.java": "",
      });

      const result = resolveImport(
        "com.example.models.User",
        path.join(project.root, "src/main/java/com/example/App.java"),
        project.root,
        project.fileSet,
        "java",
      );

      expect(result).toBe("src/main/java/com/example/models/User.java");
    });

    it("resolves imports under src/ directory", () => {
      project = createTempProject({
        "src/com/example/App.java": "",
        "src/com/example/models/User.java": "",
      });

      const result = resolveImport(
        "com.example.models.User",
        path.join(project.root, "src/com/example/App.java"),
        project.root,
        project.fileSet,
        "java",
      );

      expect(result).toBe("src/com/example/models/User.java");
    });

    it("resolves Kotlin imports under src/main/kotlin", () => {
      project = createTempProject({
        "src/main/kotlin/com/example/App.kt": "",
        "src/main/kotlin/com/example/models/User.kt": "",
      });

      const result = resolveImport(
        "com.example.models.User",
        path.join(project.root, "src/main/kotlin/com/example/App.kt"),
        project.root,
        project.fileSet,
        "kotlin",
      );

      expect(result).toBe("src/main/kotlin/com/example/models/User.kt");
    });

    it("returns null for java stdlib imports", () => {
      project = createTempProject({
        "src/App.java": "",
      });

      const result = resolveImport(
        "java.util.List",
        path.join(project.root, "src/App.java"),
        project.root,
        project.fileSet,
        "java",
      );

      expect(result).toBeNull();
    });
  });

  describe("Dart resolution", () => {
    it("resolves relative imports", () => {
      project = createTempProject({
        "lib/main.dart": "",
        "lib/utils/helpers.dart": "",
      });

      const result = resolveImport(
        "utils/helpers.dart",
        path.join(project.root, "lib/main.dart"),
        project.root,
        project.fileSet,
        "dart",
      );

      expect(result).toBe("lib/utils/helpers.dart");
    });

    it("returns null for package: imports", () => {
      project = createTempProject({
        "lib/main.dart": "",
      });

      const result = resolveImport(
        "package:flutter/material.dart",
        path.join(project.root, "lib/main.dart"),
        project.root,
        project.fileSet,
        "dart",
      );

      expect(result).toBeNull();
    });

    it("returns null for dart: imports", () => {
      project = createTempProject({
        "lib/main.dart": "",
      });

      const result = resolveImport(
        "dart:async",
        path.join(project.root, "lib/main.dart"),
        project.root,
        project.fileSet,
        "dart",
      );

      expect(result).toBeNull();
    });
  });

  describe("Lua resolution", () => {
    it("resolves dot-separated module paths", () => {
      project = createTempProject({
        "main.lua": "",
        "utils/math.lua": "",
      });

      const result = resolveImport(
        "utils.math",
        path.join(project.root, "main.lua"),
        project.root,
        project.fileSet,
        "lua",
      );

      expect(result).toBe("utils/math.lua");
    });

    it("returns null for stdlib modules", () => {
      project = createTempProject({
        "main.lua": "",
      });

      const result = resolveImport(
        "string",
        path.join(project.root, "main.lua"),
        project.root,
        project.fileSet,
        "lua",
      );

      expect(result).toBeNull();
    });
  });

  describe("Bash resolution", () => {
    it("resolves relative source paths", () => {
      project = createTempProject({
        "run.sh": "",
        "config.sh": "",
      });

      const result = resolveImport(
        "./config.sh",
        path.join(project.root, "run.sh"),
        project.root,
        project.fileSet,
        "bash",
      );

      expect(result).toBe("config.sh");
    });
  });

  describe("unknown language", () => {
    it("returns null", () => {
      project = createTempProject({
        "file.xyz": "",
      });

      const result = resolveImport(
        "./other",
        path.join(project.root, "file.xyz"),
        project.root,
        project.fileSet,
        "unknown",
      );

      expect(result).toBeNull();
    });
  });

  // ── Go resolution ──────────────────────────────────────────────────────

  describe("Go resolution", () => {
    it("returns null (Go requires go.mod analysis)", () => {
      project = createTempProject({
        "main.go": "",
        "internal/helper.go": "",
      });

      const result = resolveImport(
        "github.com/example/pkg",
        path.join(project.root, "main.go"),
        project.root,
        project.fileSet,
        "go",
      );

      expect(result).toBeNull();
    });
  });

  // ── C# resolution ─────────────────────────────────────────────────────

  describe("C# resolution", () => {
    it("returns null when no namespace map is supplied (back-compat)", () => {
      project = createTempProject({
        "Models/User.cs": "namespace MyApp.Models { public class User {} }",
        "Program.cs": "using MyApp.Models;",
      });

      const result = resolveImport(
        "MyApp.Models",
        path.join(project.root, "Program.cs"),
        project.root,
        project.fileSet,
        "csharp",
      );

      expect(result).toBeNull();
    });

    it("resolves a using directive to a file via the namespace map", () => {
      project = createTempProject({
        "Models/User.cs": "namespace MyApp.Models { public class User {} }",
        "Program.cs": "using MyApp.Models;\nnamespace MyApp { class Program {} }",
      });

      const csNamespaceMap = buildCsNamespaceMap(project.fileSet, project.root);
      const result = resolveImport(
        "MyApp.Models",
        path.join(project.root, "Program.cs"),
        project.root,
        project.fileSet,
        "csharp",
        undefined,
        undefined,
        csNamespaceMap,
      );

      expect(result).toBe("Models/User.cs");
    });

    it("returns the first candidate when a namespace spans multiple files", () => {
      project = createTempProject({
        "Services/UserService.cs":
          "namespace MyApp.Services { public class UserService {} }",
        "Services/OrderService.cs":
          "namespace MyApp.Services { public class OrderService {} }",
        "Program.cs": "using MyApp.Services;",
      });

      const csNamespaceMap = buildCsNamespaceMap(project.fileSet, project.root);
      const result = resolveImport(
        "MyApp.Services",
        path.join(project.root, "Program.cs"),
        project.root,
        project.fileSet,
        "csharp",
        undefined,
        undefined,
        csNamespaceMap,
      );

      // Multi-file namespaces resolve to the first registered file. Files are
      // visited in lexicographic order, so OrderService.cs precedes
      // UserService.cs. Multi-file fan-out is a known follow-up.
      expect(result).toBe("Services/OrderService.cs");
    });

    it("returns null for unknown namespaces even with a populated map", () => {
      project = createTempProject({
        "Models/User.cs": "namespace MyApp.Models { public class User {} }",
        "Program.cs": "using MyApp.Unknown;",
      });

      const csNamespaceMap = buildCsNamespaceMap(project.fileSet, project.root);
      const result = resolveImport(
        "MyApp.Unknown",
        path.join(project.root, "Program.cs"),
        project.root,
        project.fileSet,
        "csharp",
        undefined,
        undefined,
        csNamespaceMap,
      );

      expect(result).toBeNull();
    });

    it("filters System.* and Microsoft.* as external before consulting the map", () => {
      project = createTempProject({
        "Program.cs": "namespace System.Collections { class Stub {} }",
      });

      const csNamespaceMap = buildCsNamespaceMap(project.fileSet, project.root);
      const result = resolveImport(
        "System.Collections",
        path.join(project.root, "Program.cs"),
        project.root,
        project.fileSet,
        "csharp",
        undefined,
        undefined,
        csNamespaceMap,
      );

      expect(result).toBeNull();
    });
  });

  // ── buildCsNamespaceMap ───────────────────────────────────────────────

  describe("buildCsNamespaceMap", () => {
    it("indexes block-scoped namespace declarations in lexicographic order", () => {
      project = createTempProject({
        "Models/User.cs": "namespace MyApp.Models { public class User {} }",
        "Models/Order.cs": "namespace MyApp.Models { public class Order {} }",
      });

      const map = buildCsNamespaceMap(project.fileSet, project.root);
      // Files are sorted lexically, so Order.cs comes before User.cs.
      expect(map.get("MyApp.Models")).toEqual([
        "Models/Order.cs",
        "Models/User.cs",
      ]);
    });

    it("returns the same candidate order regardless of fileSet insertion order", () => {
      // Build two projects on the same physical layout but feed buildCsNamespaceMap
      // a Set populated in two different orders, mimicking how fs.readdir() can
      // hand back entries in arbitrary order across filesystems.
      project = createTempProject({
        "Services/UserService.cs":
          "namespace MyApp.Services { public class UserService {} }",
        "Services/OrderService.cs":
          "namespace MyApp.Services { public class OrderService {} }",
        "Services/AccountService.cs":
          "namespace MyApp.Services { public class AccountService {} }",
      });

      const forward = new Set([
        "Services/AccountService.cs",
        "Services/OrderService.cs",
        "Services/UserService.cs",
      ]);
      const reverse = new Set([
        "Services/UserService.cs",
        "Services/OrderService.cs",
        "Services/AccountService.cs",
      ]);

      const a = buildCsNamespaceMap(forward, project.root);
      const b = buildCsNamespaceMap(reverse, project.root);

      expect(a.get("MyApp.Services")).toEqual(b.get("MyApp.Services"));
      expect(a.get("MyApp.Services")?.[0]).toBe("Services/AccountService.cs");
    });

    it("indexes file-scoped namespace declarations (C# 10+)", () => {
      project = createTempProject({
        "Services/UserService.cs":
          "namespace MyApp.Services;\n\npublic class UserService {}",
      });

      const map = buildCsNamespaceMap(project.fileSet, project.root);
      expect(map.get("MyApp.Services")).toEqual(["Services/UserService.cs"]);
    });

    it("registers multiple namespaces declared in the same file", () => {
      project = createTempProject({
        "Mixed.cs":
          "namespace MyApp.A { class A {} }\nnamespace MyApp.B { class B {} }",
      });

      const map = buildCsNamespaceMap(project.fileSet, project.root);
      expect(map.get("MyApp.A")).toEqual(["Mixed.cs"]);
      expect(map.get("MyApp.B")).toEqual(["Mixed.cs"]);
    });

    it("does not match commented-out namespace lines", () => {
      project = createTempProject({
        "Program.cs":
          "// namespace MyApp.Hidden;\nnamespace MyApp.Real { class C {} }",
      });

      const map = buildCsNamespaceMap(project.fileSet, project.root);
      expect(map.has("MyApp.Hidden")).toBe(false);
      expect(map.get("MyApp.Real")).toEqual(["Program.cs"]);
    });

    it("ignores non-.cs files", () => {
      project = createTempProject({
        "notes.txt": "namespace Fake.Namespace;",
        "Program.cs": "namespace Real.Namespace { class C {} }",
      });

      const map = buildCsNamespaceMap(project.fileSet, project.root);
      expect(map.has("Fake.Namespace")).toBe(false);
      expect(map.get("Real.Namespace")).toEqual(["Program.cs"]);
    });

    it("returns an empty map for a project with no .cs files", () => {
      project = createTempProject({ "index.ts": "", "style.css": "" });
      const map = buildCsNamespaceMap(project.fileSet, project.root);
      expect(map.size).toBe(0);
    });

    it("does not duplicate the same file when re-indexed", () => {
      project = createTempProject({
        "Dup.cs": "namespace MyApp.X { class A {} }\nnamespace MyApp.X { class B {} }",
      });

      const map = buildCsNamespaceMap(project.fileSet, project.root);
      expect(map.get("MyApp.X")).toEqual(["Dup.cs"]);
    });

    it("captures nested namespace declarations indented inside an outer block", () => {
      project = createTempProject({
        "Nested.cs":
          "namespace Outer\n{\n    namespace Inner\n    {\n        class C {}\n    }\n}\n",
      });

      const map = buildCsNamespaceMap(project.fileSet, project.root);
      expect(map.get("Outer")).toEqual(["Nested.cs"]);
      expect(map.get("Inner")).toEqual(["Nested.cs"]);
    });

    it("rejects identifiers that do not start with a letter or underscore", () => {
      project = createTempProject({
        // Invalid C# (digit-leading), should not be captured.
        "Bad.cs": "namespace 1Foo { class C {} }",
        // Valid neighbour to make sure the scan still works.
        "Good.cs": "namespace Real.NS { class C {} }",
      });

      const map = buildCsNamespaceMap(project.fileSet, project.root);
      expect(map.has("1Foo")).toBe(false);
      expect(map.get("Real.NS")).toEqual(["Good.cs"]);
    });

    it("requires a `;` or `{` after the namespace name to avoid false positives", () => {
      project = createTempProject({
        // The token `namespace MyApp.Hint` appears here but is not a real
        // declaration (no terminator), so it must not be captured. The
        // real declaration on the next line should be captured.
        "Mixed.cs":
          "// see also: namespace MyApp.Hint in legacy code\nnamespace MyApp.Real { class C {} }",
      });

      const map = buildCsNamespaceMap(project.fileSet, project.root);
      expect(map.has("MyApp.Hint")).toBe(false);
      expect(map.get("MyApp.Real")).toEqual(["Mixed.cs"]);
    });
  });

  // ── Swift resolution ──────────────────────────────────────────────────

  describe("Swift resolution", () => {
    it("resolves relative imports", () => {
      project = createTempProject({
        "Sources/App/main.swift": "",
        "Sources/App/helper.swift": "",
      });

      const result = resolveImport(
        "./helper",
        path.join(project.root, "Sources/App/main.swift"),
        project.root,
        project.fileSet,
        "swift",
      );

      expect(result).toBe("Sources/App/helper.swift");
    });

    it("returns null for framework imports", () => {
      project = createTempProject({
        "main.swift": "",
      });

      const result = resolveImport(
        "Foundation",
        path.join(project.root, "main.swift"),
        project.root,
        project.fileSet,
        "swift",
      );

      expect(result).toBeNull();
    });
  });

  // ── Scala resolution ──────────────────────────────────────────────────

  describe("Scala resolution", () => {
    it("resolves package path to file in src/main/scala", () => {
      project = createTempProject({
        "src/main/scala/com/example/models/User.scala": "",
      });

      const result = resolveImport(
        "com.example.models.User",
        path.join(project.root, "src/main/scala/com/example/App.scala"),
        project.root,
        project.fileSet,
        "scala",
      );

      expect(result).toBe("src/main/scala/com/example/models/User.scala");
    });

    it("returns null for stdlib imports", () => {
      project = createTempProject({
        "Main.scala": "",
      });

      const result = resolveImport(
        "scala.collection.mutable.ListBuffer",
        path.join(project.root, "Main.scala"),
        project.root,
        project.fileSet,
        "scala",
      );

      expect(result).toBeNull();
    });
  });

  // ── Kotlin resolution ─────────────────────────────────────────────────

  describe("Kotlin resolution", () => {
    it("resolves package path to file in src/main/kotlin", () => {
      project = createTempProject({
        "src/main/kotlin/com/example/models/User.kt": "",
      });

      const result = resolveImport(
        "com.example.models.User",
        path.join(project.root, "src/main/kotlin/com/example/App.kt"),
        project.root,
        project.fileSet,
        "kotlin",
      );

      expect(result).toBe("src/main/kotlin/com/example/models/User.kt");
    });

    it("returns null for stdlib imports", () => {
      project = createTempProject({
        "Main.kt": "",
      });

      const result = resolveImport(
        "kotlinx.coroutines.launch",
        path.join(project.root, "Main.kt"),
        project.root,
        project.fileSet,
        "kotlin",
      );

      expect(result).toBeNull();
    });
  });

  // ── Path alias resolution ──────────────────────────────────────────────

  describe("Path alias resolution", () => {
    it("resolves $lib/ alias to src/lib/", () => {
      project = createTempProject({
        "src/lib/Component.svelte": "",
        "src/routes/page.svelte": "",
      });

      const aliases = {
        entries: new Map([["$lib/", ["src/lib/"]]]),
      };

      const result = resolveImport(
        "$lib/Component.svelte",
        path.join(project.root, "src/routes/page.svelte"),
        project.root,
        project.fileSet,
        "svelte",
        aliases,
      );

      expect(result).toBe("src/lib/Component.svelte");
    });

    it("resolves @/ alias to src/", () => {
      project = createTempProject({
        "src/utils/helper.ts": "",
        "src/index.ts": "",
      });

      const aliases = {
        entries: new Map([["@/", ["src/"]]]),
      };

      const result = resolveImport(
        "@/utils/helper",
        path.join(project.root, "src/index.ts"),
        project.root,
        project.fileSet,
        "typescript",
        aliases,
      );

      expect(result).toBe("src/utils/helper.ts");
    });

    it("resolves alias with extensionless import", () => {
      project = createTempProject({
        "src/lib/utils.ts": "",
        "src/app.ts": "",
      });

      const aliases = {
        entries: new Map([["$lib/", ["src/lib/"]]]),
      };

      const result = resolveImport(
        "$lib/utils",
        path.join(project.root, "src/app.ts"),
        project.root,
        project.fileSet,
        "typescript",
        aliases,
      );

      expect(result).toBe("src/lib/utils.ts");
    });

    it("returns null when alias does not match any file", () => {
      project = createTempProject({
        "src/index.ts": "",
      });

      const aliases = {
        entries: new Map([["$lib/", ["src/lib/"]]]),
      };

      const result = resolveImport(
        "$lib/NonExistent",
        path.join(project.root, "src/index.ts"),
        project.root,
        project.fileSet,
        "typescript",
        aliases,
      );

      expect(result).toBeNull();
    });

    it("falls back to null without aliases (backwards compatible)", () => {
      project = createTempProject({
        "src/index.ts": "",
      });

      const result = resolveImport(
        "$lib/Component",
        path.join(project.root, "src/index.ts"),
        project.root,
        project.fileSet,
        "typescript",
      );

      expect(result).toBeNull();
    });

    it("tries multiple alias targets in order (first match wins)", () => {
      project = createTempProject({
        "src/types.ts": "",
        "generated/types.ts": "",
        "src/index.ts": "",
      });

      const aliases = {
        entries: new Map([["@/", ["src", "generated"]]]),
      };

      const result = resolveImport(
        "@/types",
        path.join(project.root, "src/index.ts"),
        project.root,
        project.fileSet,
        "typescript",
        aliases,
      );

      // src/ is listed first, so it should win over generated/
      expect(result).toBe("src/types.ts");
    });

    it("falls back to second alias target when first has no match", () => {
      project = createTempProject({
        "generated/types.ts": "",
        "src/index.ts": "",
      });

      const aliases = {
        entries: new Map([["@/", ["src", "generated"]]]),
      };

      const result = resolveImport(
        "@/types",
        path.join(project.root, "src/index.ts"),
        project.root,
        project.fileSet,
        "typescript",
        aliases,
      );

      expect(result).toBe("generated/types.ts");
    });

    it("resolves CSS alias imports", () => {
      project = createTempProject({
        "src/lib/styles/variables.css": "",
        "src/app.css": "",
      });

      const aliases = {
        entries: new Map([["$lib/", ["src/lib/"]]]),
      };

      const result = resolveImport(
        "$lib/styles/variables.css",
        path.join(project.root, "src/app.css"),
        project.root,
        project.fileSet,
        "css",
        aliases,
      );

      expect(result).toBe("src/lib/styles/variables.css");
    });

    it("resolves extensionless CSS alias import via extension-try loop", () => {
      project = createTempProject({
        "src/lib/styles/variables.scss": "",
        "src/app.css": "",
      });

      const aliases = {
        entries: new Map([["$lib/", ["src/lib"]]]),
      };

      const result = resolveImport(
        "$lib/styles/variables",
        path.join(project.root, "src/app.css"),
        project.root,
        project.fileSet,
        "css",
        aliases,
      );

      expect(result).toBe("src/lib/styles/variables.scss");
    });

    it("resolves CSS relative imports", () => {
      project = createTempProject({
        "src/styles/variables.css": "",
        "src/styles/main.css": "",
      });

      const result = resolveImport(
        "./variables.css",
        path.join(project.root, "src/styles/main.css"),
        project.root,
        project.fileSet,
        "css",
      );

      expect(result).toBe("src/styles/variables.css");
    });

    it("resolves SCSS relative imports (language=scss)", () => {
      project = createTempProject({
        "src/styles/theme.scss": "",
        "src/styles/main.scss": "",
      });

      const result = resolveImport(
        "./theme.scss",
        path.join(project.root, "src/styles/main.scss"),
        project.root,
        project.fileSet,
        "scss",
      );

      expect(result).toBe("src/styles/theme.scss");
    });

    it("resolves SCSS partial with _ prefix", () => {
      project = createTempProject({
        "src/styles/_variables.scss": "",
        "src/styles/main.scss": "",
      });

      const result = resolveImport(
        "./variables",
        path.join(project.root, "src/styles/main.scss"),
        project.root,
        project.fileSet,
        "scss",
      );

      expect(result).toBe("src/styles/_variables.scss");
    });

    it("resolves SCSS partial via alias", () => {
      project = createTempProject({
        "src/lib/styles/_colors.scss": "",
        "src/app.scss": "",
      });

      const aliases = {
        entries: new Map([["$lib/", ["src/lib"]]]),
      };

      const result = resolveImport(
        "$lib/styles/colors",
        path.join(project.root, "src/app.scss"),
        project.root,
        project.fileSet,
        "scss",
        aliases,
      );

      expect(result).toBe("src/lib/styles/_colors.scss");
    });

    it("prefers non-partial over partial when both exist", () => {
      project = createTempProject({
        "src/styles/variables.scss": "",
        "src/styles/_variables.scss": "",
        "src/styles/main.scss": "",
      });

      const result = resolveImport(
        "./variables",
        path.join(project.root, "src/styles/main.scss"),
        project.root,
        project.fileSet,
        "scss",
      );

      // Direct match with extension should win before trying _ prefix
      expect(result).toBe("src/styles/variables.scss");
    });

    it("resolves SCSS partial when import has explicit .scss extension", () => {
      project = createTempProject({
        "src/styles/_variables.scss": "",
        "src/styles/main.scss": "",
      });

      const result = resolveImport(
        "./variables.scss",
        path.join(project.root, "src/styles/main.scss"),
        project.root,
        project.fileSet,
        "scss",
      );

      expect(result).toBe("src/styles/_variables.scss");
    });

    it("resolves Less relative imports (language=less)", () => {
      project = createTempProject({
        "src/styles/theme.less": "",
        "src/styles/main.less": "",
      });

      const result = resolveImport(
        "./theme.less",
        path.join(project.root, "src/styles/main.less"),
        project.root,
        project.fileSet,
        "less",
      );

      expect(result).toBe("src/styles/theme.less");
    });

    it("resolves Sass relative imports (language=sass)", () => {
      project = createTempProject({
        "src/styles/_base.sass": "",
        "src/styles/main.sass": "",
      });

      const result = resolveImport(
        "./base",
        path.join(project.root, "src/styles/main.sass"),
        project.root,
        project.fileSet,
        "sass",
      );

      expect(result).toBe("src/styles/_base.sass");
    });

    it("exact alias pattern only matches exact specifier", () => {
      project = createTempProject({
        "src/index.ts": "",
        "src/utils/helper.ts": "",
      });

      const aliases = {
        entries: new Map([["~", ["src"]]]),
      };

      // "~utils/helper" should NOT match exact alias "~"
      const noMatch = resolveImport(
        "~utils/helper",
        path.join(project.root, "src/index.ts"),
        project.root,
        project.fileSet,
        "typescript",
        aliases,
      );
      expect(noMatch).toBeNull();

      // Exact "~" should resolve to src directory index
      const exactMatch = resolveImport(
        "~",
        path.join(project.root, "src/index.ts"),
        project.root,
        project.fileSet,
        "typescript",
        aliases,
      );
      expect(exactMatch).toBe("src/index.ts");
    });

    it("returns null for bare CSS package specifier", () => {
      project = createTempProject({
        "src/styles/main.css": "",
      });

      const result = resolveImport(
        "normalize.css",
        path.join(project.root, "src/styles/main.css"),
        project.root,
        project.fileSet,
        "css",
      );

      expect(result).toBeNull();
    });
  });

  // ── buildJvmSuffixMap + multi-module resolution ──────────────────────────

  describe("JVM multi-module resolution (buildJvmSuffixMap)", () => {
    it("builds a suffix map keyed by class path after src/main/java", () => {
      project = createTempProject({
        [`module-a${path.sep}sub${path.sep}src${path.sep}main${path.sep}java${path.sep}com${path.sep}example${path.sep}Foo.java`]: "",
        [`module-b${path.sep}src${path.sep}main${path.sep}kotlin${path.sep}com${path.sep}example${path.sep}Bar.kt`]: "",
        [`module-c${path.sep}src${path.sep}main${path.sep}scala${path.sep}com${path.sep}example${path.sep}Baz.scala`]: "",
      });

      const map = buildJvmSuffixMap(project.fileSet);

      expect(map.has(`com${path.sep}example${path.sep}Foo.java`)).toBe(true);
      expect(map.has(`com${path.sep}example${path.sep}Bar.kt`)).toBe(true);
      expect(map.has(`com${path.sep}example${path.sep}Baz.scala`)).toBe(true);
    });

    it("returns empty map when project has no JVM files", () => {
      project = createTempProject({ "index.ts": "", "style.css": "" });
      const map = buildJvmSuffixMap(project.fileSet);
      expect(map.size).toBe(0);
    });

    it("ignores JVM files outside src/main/<lang> (e.g. test sources)", () => {
      project = createTempProject({
        // test source — should be ignored
        [`module-a${path.sep}src${path.sep}test${path.sep}java${path.sep}com${path.sep}example${path.sep}FooTest.java`]: "",
        // main source — should be registered
        [`module-a${path.sep}src${path.sep}main${path.sep}java${path.sep}com${path.sep}example${path.sep}Foo.java`]: "",
      });

      const map = buildJvmSuffixMap(project.fileSet);
      expect(map.has(`com${path.sep}example${path.sep}Foo.java`)).toBe(true);
      expect(map.has(`com${path.sep}example${path.sep}FooTest.java`)).toBe(false);
    });

    it("resolves a Java import in a multi-module Maven project via suffix map", () => {
      // Simulate: module-sso/module-sso-service/src/main/java/cn/sino/sso/UserService.java
      const userServicePath =
        `module-sso${path.sep}module-sso-service${path.sep}src${path.sep}main${path.sep}java${path.sep}cn${path.sep}sino${path.sep}sso${path.sep}UserService.java`;
      const callerPath =
        `module-opt${path.sep}src${path.sep}main${path.sep}java${path.sep}cn${path.sep}sino${path.sep}opt${path.sep}Service.java`;

      project = createTempProject({
        [userServicePath]: "",
        [callerPath]: "",
      });

      const jvmSuffixMap = buildJvmSuffixMap(project.fileSet);

      const result = resolveImport(
        "cn.sino.sso.UserService",
        path.join(project.root, callerPath),
        project.root,
        project.fileSet,
        "java",
        undefined,
        jvmSuffixMap,
      );

      expect(result).toBe(userServicePath);
    });

    it("resolves Kotlin import in multi-module project via suffix map", () => {
      const barPath =
        `module-core${path.sep}src${path.sep}main${path.sep}kotlin${path.sep}com${path.sep}example${path.sep}Bar.kt`;
      const callerPath =
        `module-api${path.sep}src${path.sep}main${path.sep}kotlin${path.sep}com${path.sep}example${path.sep}Caller.kt`;

      project = createTempProject({ [barPath]: "", [callerPath]: "" });

      const jvmSuffixMap = buildJvmSuffixMap(project.fileSet);
      const result = resolveImport(
        "com.example.Bar",
        path.join(project.root, callerPath),
        project.root,
        project.fileSet,
        "kotlin",
        undefined,
        jvmSuffixMap,
      );

      expect(result).toBe(barPath);
    });

    it("returns null when class exists nowhere in the project", () => {
      project = createTempProject({
        [`module-a${path.sep}src${path.sep}main${path.sep}java${path.sep}com${path.sep}example${path.sep}Foo.java`]: "",
      });

      const jvmSuffixMap = buildJvmSuffixMap(project.fileSet);
      const result = resolveImport(
        "com.example.NonExistent",
        path.join(project.root, `module-a${path.sep}src${path.sep}main${path.sep}java${path.sep}com${path.sep}example${path.sep}Foo.java`),
        project.root,
        project.fileSet,
        "java",
        undefined,
        jvmSuffixMap,
      );

      expect(result).toBeNull();
    });

    it("still returns null for java stdlib even with suffix map", () => {
      project = createTempProject({
        [`module-a${path.sep}src${path.sep}main${path.sep}java${path.sep}java${path.sep}util${path.sep}List.java`]: "",
      });

      const jvmSuffixMap = buildJvmSuffixMap(project.fileSet);
      const result = resolveImport(
        "java.util.List",
        path.join(project.root, `module-a${path.sep}src${path.sep}main${path.sep}java${path.sep}Caller.java`),
        project.root,
        project.fileSet,
        "java",
        undefined,
        jvmSuffixMap,
      );

      expect(result).toBeNull();
    });
  });
});
