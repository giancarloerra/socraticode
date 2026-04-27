// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited

import { Lang } from "@ast-grep/napi";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureDynamicLanguages } from "../../src/services/code-graph.js";
import {
  extractSymbolsAndCalls,
  rawCallsToUnresolvedEdges,
} from "../../src/services/graph-symbols.js";

beforeAll(() => {
  ensureDynamicLanguages();
});

describe("graph-symbols", () => {
  describe("TypeScript/JavaScript", () => {
    it("extracts function declarations and synthesizes a <module> symbol", () => {
      const src = `
function foo() { return 1; }
function bar() { return foo(); }
`;
      const out = extractSymbolsAndCalls(src, Lang.TypeScript, ".ts", "src/a.ts");
      const names = out.symbols.map((s) => s.name).sort();
      expect(names).toContain("<module>");
      expect(names).toContain("foo");
      expect(names).toContain("bar");
    });

    it("attributes calls inside a function to that function as caller", () => {
      const src = `
function foo() {}
function bar() { foo(); }
`;
      const out = extractSymbolsAndCalls(src, Lang.TypeScript, ".ts", "src/b.ts");
      const fooCall = out.rawCalls.find((c) => c.calleeName === "foo");
      expect(fooCall).toBeDefined();
      expect(fooCall?.callerId).toContain("::bar#");
    });

    it("extracts class methods with qualified names", () => {
      const src = `
class Foo {
  bar() { return 1; }
  baz() { return this.bar(); }
}
`;
      const out = extractSymbolsAndCalls(src, Lang.TypeScript, ".ts", "src/c.ts");
      const qnames = out.symbols.map((s) => s.qualifiedName);
      expect(qnames).toContain("Foo.bar");
      expect(qnames).toContain("Foo.baz");
      const kinds = out.symbols.filter((s) => s.qualifiedName === "Foo.bar").map((s) => s.kind);
      expect(kinds).toContain("method");
    });

    it("extracts arrow function constants", () => {
      const src = `
export const validate = (x: number) => x > 0;
const helper = function () { return 42; };
`;
      const out = extractSymbolsAndCalls(src, Lang.TypeScript, ".ts", "src/d.ts");
      const names = out.symbols.map((s) => s.name);
      expect(names).toContain("validate");
      expect(names).toContain("helper");
    });
  });

  describe("Python", () => {
    it("extracts def and class symbols", () => {
      const src = `
def foo():
    return 1

class Bar:
    def baz(self):
        return foo()
`;
      const out = extractSymbolsAndCalls(src, "python" as unknown as Lang, ".py", "app.py");
      const names = out.symbols.map((s) => s.name);
      expect(names).toContain("foo");
      expect(names).toContain("Bar");
      expect(names).toContain("baz");
    });
  });

  describe("Go", () => {
    it("extracts func declarations", () => {
      const src = `
package main

func Foo() int { return 1 }

func Bar() int { return Foo() }
`;
      const out = extractSymbolsAndCalls(src, "go" as unknown as Lang, ".go", "main.go");
      const names = out.symbols.map((s) => s.name);
      expect(names).toContain("Foo");
      expect(names).toContain("Bar");
    });
  });

  describe("rawCallsToUnresolvedEdges", () => {
    it("converts raw calls to unresolved SymbolEdge objects", () => {
      const raw = [
        {
          callerId: "src/a.ts::foo#1",
          calleeName: "bar",
          callSite: { file: "src/a.ts", line: 5 },
        },
      ];
      const edges = rawCallsToUnresolvedEdges(raw);
      expect(edges).toHaveLength(1);
      expect(edges[0].confidence).toBe("unresolved");
      expect(edges[0].calleeCandidates).toEqual([]);
      expect(edges[0].calleeName).toBe("bar");
    });
  });

  describe("Rust", () => {
    it("extracts fn and impl methods", () => {
      const src = `
fn foo() -> i32 { 1 }

struct S;
impl S {
    fn bar(&self) -> i32 { foo() }
}
`;
      const out = extractSymbolsAndCalls(src, "rust" as unknown as Lang, ".rs", "lib.rs");
      const names = out.symbols.map((s) => s.name);
      expect(names).toContain("foo");
      expect(names).toContain("bar");
      expect(out.symbols.some((s) => s.name === "<module>")).toBe(true);
    });
  });

  describe("Java / Kotlin / Scala (JVM family)", () => {
    it("extracts Java class and methods", () => {
      const src = `
public class Foo {
    public int bar() { return 1; }
    public int baz() { return bar(); }
}
`;
      const out = extractSymbolsAndCalls(src, "java" as unknown as Lang, ".java", "Foo.java");
      const names = out.symbols.map((s) => s.name);
      expect(names).toContain("Foo");
      expect(names).toContain("bar");
      expect(names).toContain("baz");
    });

    it("extracts Kotlin top-level fun and class methods", () => {
      const src = `
fun greet(name: String): String = "Hi"

class Bar {
    fun work(): String = greet("x")
}
`;
      const out = extractSymbolsAndCalls(src, "kotlin" as unknown as Lang, ".kt", "main.kt");
      const names = out.symbols.map((s) => s.name);
      expect(names).toContain("greet");
      expect(names).toContain("Bar");
      expect(names).toContain("work");
    });

    it("extracts Scala def and class", () => {
      const src = `
class Foo {
  def bar(): Int = 1
}

object Main {
  def main(args: Array[String]): Unit = println("hi")
}
`;
      const out = extractSymbolsAndCalls(src, "scala" as unknown as Lang, ".scala", "Main.scala");
      const names = out.symbols.map((s) => s.name);
      expect(names).toContain("bar");
      expect(names).toContain("main");
    });
  });

  describe("C#", () => {
    it("extracts class and methods", () => {
      const src = `
namespace App {
    public class Foo {
        public int Bar() { return 1; }
        public int Baz() { return Bar(); }
    }
}
`;
      const out = extractSymbolsAndCalls(src, "csharp" as unknown as Lang, ".cs", "Foo.cs");
      const names = out.symbols.map((s) => s.name);
      expect(names).toContain("Foo");
      expect(names).toContain("Bar");
      expect(names).toContain("Baz");
    });
  });

  describe("C / C++", () => {
    it("extracts C function definitions", () => {
      const src = `
int add(int a, int b) { return a + b; }

int main(void) {
    return add(2, 3);
}
`;
      const out = extractSymbolsAndCalls(src, "c" as unknown as Lang, ".c", "main.c");
      const names = out.symbols.map((s) => s.name);
      expect(names).toContain("add");
      expect(names).toContain("main");
    });

    it("extracts C++ class declarations and free functions", () => {
      // Note: inline class methods are `field_declaration` nodes in tree-sitter-cpp,
      // not `function_definition`, so the current extractor catches them only
      // when defined out-of-line. See language-coverage table in DEVELOPER.md.
      const src = `
class Foo {
public:
    int bar();
};

int Foo::bar() { return 1; }
int helper() { return 42; }
`;
      const out = extractSymbolsAndCalls(src, "cpp" as unknown as Lang, ".cpp", "Foo.cpp");
      const names = out.symbols.map((s) => s.name);
      expect(names).toContain("Foo");
      expect(names).toContain("helper");
      // Out-of-line method `Foo::bar` is detected as qualifiedName "Foo::bar".
      const qnames = out.symbols.map((s) => s.qualifiedName);
      expect(qnames.some((q) => q === "Foo::bar" || q === "bar")).toBe(true);
    });
  });

  describe("Ruby", () => {
    it("extracts def and class", () => {
      const src = `
def foo
  1
end

class Bar
  def baz
    foo
  end
end
`;
      const out = extractSymbolsAndCalls(src, "ruby" as unknown as Lang, ".rb", "app.rb");
      const names = out.symbols.map((s) => s.name);
      expect(names).toContain("foo");
      expect(names).toContain("Bar");
      expect(names).toContain("baz");
    });
  });

  describe("PHP", () => {
    it("extracts function and class methods", () => {
      const src = `<?php
function greet($name) {
  return "Hi " . $name;
}

class Foo {
  public function bar() {
    return greet("x");
  }
}
`;
      const out = extractSymbolsAndCalls(src, "php" as unknown as Lang, ".php", "index.php");
      const names = out.symbols.map((s) => s.name);
      expect(names).toContain("greet");
      expect(names).toContain("Foo");
      expect(names).toContain("bar");
    });
  });

  describe("Swift", () => {
    it("extracts Swift func and class", () => {
      const src = `
func greet(name: String) -> String { return "Hi" }

class Foo {
    func bar() -> String { return greet(name: "x") }
}
`;
      const out = extractSymbolsAndCalls(src, "swift" as unknown as Lang, ".swift", "App.swift");
      const names = out.symbols.map((s) => s.name);
      expect(names).toContain("greet");
      expect(names).toContain("Foo");
      expect(names).toContain("bar");
    });
  });

  describe("Bash", () => {
    it("extracts shell function definitions", () => {
      const src = `
greet() {
  echo "hi $1"
}

main() {
  greet "world"
}
`;
      const out = extractSymbolsAndCalls(src, "bash" as unknown as Lang, ".sh", "run.sh");
      const names = out.symbols.map((s) => s.name);
      expect(names).toContain("greet");
      expect(names).toContain("main");
    });
  });

  describe("Regex fallback (Dart, Lua, Svelte, Vue, unknown)", () => {
    it("handles Dart via regex fallback", () => {
      const src = `
String greet(String name) {
  return 'Hi $name';
}

class Foo {
  int bar() => 1;
}
`;
      const out = extractSymbolsAndCalls(src, "dart" as unknown as Lang, ".dart", "main.dart");
      // regex fallback should at least produce <module> and not throw
      expect(out.symbols.some((s) => s.name === "<module>")).toBe(true);
      const names = out.symbols.map((s) => s.name);
      // best-effort detection: should find at least one named symbol
      expect(names.length).toBeGreaterThanOrEqual(1);
    });

    it("handles Lua via regex fallback", () => {
      const src = `
function greet(name)
  return "hi " .. name
end

local function helper()
  return greet("x")
end
`;
      const out = extractSymbolsAndCalls(src, "lua" as unknown as Lang, ".lua", "init.lua");
      expect(out.symbols.some((s) => s.name === "<module>")).toBe(true);
    });

    it("handles unknown language without throwing", () => {
      const src = "some random text\nwith no recognizable structure";
      const out = extractSymbolsAndCalls(
        src,
        "unknown" as unknown as Lang,
        ".xyz",
        "data.xyz",
      );
      expect(out.symbols.some((s) => s.name === "<module>")).toBe(true);
      expect(out.rawCalls).toEqual([]);
    });
  });
});
