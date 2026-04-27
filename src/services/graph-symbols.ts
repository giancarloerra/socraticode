// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited

/**
 * Per-language symbol & call-site extraction (mirrors `graph-imports.ts`).
 *
 * Populated in Phase B with ast-grep patterns for each language.
 */

import { Lang, parse } from "@ast-grep/napi";
import { getLanguageFromExtension } from "../constants.js";
import type { SymbolEdge, SymbolKind, SymbolNode } from "../types.js";
import { logger } from "./logger.js";

/** Result of extracting symbols + raw call sites from a file. */
export interface ExtractedSymbols {
  symbols: SymbolNode[];
  /** Outgoing call sites — `calleeCandidates` and `confidence` are filled later by resolution. */
  rawCalls: Array<{
    callerId: string;
    calleeName: string;
    callSite: { file: string; line: number };
  }>;
}

/** Build a stable SymbolNode.id. */
function makeId(file: string, qualifiedName: string, line: number): string {
  return `${file}::${qualifiedName}#${line}`;
}

/**
 * Wrapper around `node.findAll({rule:{kind}})` that swallows ast-grep
 * "Invalid Kind" errors. Different language grammars expose different node
 * kinds, so a kind that is valid for Kotlin (`object_declaration`) may be
 * rejected by Java's grammar and abort the entire extraction. Logging is
 * intentionally omitted at debug-level to avoid log spam on every file.
 */
// biome-ignore lint/suspicious/noExplicitAny: ast-grep node type leaks through
function safeFindAll(node: any, kind: string): any[] {
  try {
    return node.findAll({ rule: { kind } });
  } catch {
    return [];
  }
}

interface ScopeFrame {
  name: string;
  /** Line at which this scope begins (used to limit call-site attribution). */
  startLine: number;
  endLine: number;
  symbolId: string;
}

/** Find the deepest scope frame covering a line. */
function findCallerId(scopes: ScopeFrame[], line: number, fallback: string): string {
  let best: ScopeFrame | null = null;
  for (const s of scopes) {
    if (line >= s.startLine && line <= s.endLine) {
      if (!best || s.startLine >= best.startLine) best = s;
    }
  }
  return best ? best.symbolId : fallback;
}

/**
 * Public entry point: extract symbols and raw call sites from a source file.
 * Returns empty arrays if the language is unsupported or parsing fails.
 */
export function extractSymbolsAndCalls(
  source: string,
  lang: Lang | string,
  ext: string,
  relativePath: string,
): ExtractedSymbols {
  const language = getLanguageFromExtension(ext);
  const langKey = String(lang);

  // Per-file synthetic "module" scope so unattributed calls have a caller.
  const moduleSymbol: SymbolNode = {
    id: makeId(relativePath, "<module>", 1),
    name: "<module>",
    qualifiedName: "<module>",
    kind: "module",
    file: relativePath,
    line: 1,
    endLine: source.split("\n").length,
    language,
  };

  try {
    if (
      langKey === Lang.JavaScript ||
      langKey === Lang.TypeScript ||
      langKey === Lang.Tsx
    ) {
      return extractFromTsLike(source, lang as Lang, relativePath, language, moduleSymbol);
    }
    if (langKey === "python") {
      return extractFromPython(source, relativePath, language, moduleSymbol);
    }
    if (langKey === "go") {
      return extractFromGo(source, relativePath, language, moduleSymbol);
    }
    if (langKey === "rust") {
      return extractFromRust(source, relativePath, language, moduleSymbol);
    }
    if (langKey === "java" || langKey === "kotlin" || langKey === "scala") {
      return extractFromJvm(source, lang as string, relativePath, language, moduleSymbol);
    }
    if (langKey === "csharp") {
      return extractFromCSharp(source, relativePath, language, moduleSymbol);
    }
    if (langKey === "c" || langKey === "cpp") {
      return extractFromCFamily(source, lang as string, relativePath, language, moduleSymbol);
    }
    if (langKey === "ruby") {
      return extractFromRuby(source, relativePath, language, moduleSymbol);
    }
    if (langKey === "php") {
      return extractFromPhp(source, relativePath, language, moduleSymbol);
    }
    if (langKey === "swift") {
      return extractFromSwift(source, relativePath, language, moduleSymbol);
    }
    if (langKey === "bash") {
      return extractFromBash(source, relativePath, language, moduleSymbol);
    }
    // Dart, Lua, Svelte, Vue and others fall through to the regex fallback.
    return extractFromRegex(source, relativePath, language, moduleSymbol);
  } catch (err) {
    logger.debug("extractSymbolsAndCalls failed", {
      file: relativePath,
      lang: langKey,
      error: err instanceof Error ? err.message : String(err),
    });
    return { symbols: [moduleSymbol], rawCalls: [] };
  }
}

// ── JS / TS / TSX ────────────────────────────────────────────────────────

function extractFromTsLike(
  source: string,
  lang: Lang,
  file: string,
  language: string,
  moduleSym: SymbolNode,
): ExtractedSymbols {
  const root = parse(lang, source).root();
  const symbols: SymbolNode[] = [moduleSym];
  const scopes: ScopeFrame[] = [];

  // Class declarations
  for (const node of safeFindAll(root, "class_declaration")) {
    const nameNode = node.find({ rule: { kind: "type_identifier" } })
      ?? node.find({ rule: { kind: "identifier" } });
    if (!nameNode) continue;
    const name = nameNode.text();
    const range = node.range();
    const startLine = range.start.line + 1;
    const endLine = range.end.line + 1;
    const sym: SymbolNode = {
      id: makeId(file, name, startLine),
      name, qualifiedName: name, kind: "class", file, line: startLine, endLine, language,
    };
    symbols.push(sym);
    scopes.push({ name, startLine, endLine, symbolId: sym.id });

    // Methods inside the class
    for (const m of safeFindAll(node, "method_definition")) {
      const mName = m.find({ rule: { kind: "property_identifier" } })?.text();
      if (!mName) continue;
      const mr = m.range();
      const mStart = mr.start.line + 1;
      const mEnd = mr.end.line + 1;
      const qname = `${name}.${mName}`;
      const msym: SymbolNode = {
        id: makeId(file, qname, mStart),
        name: mName, qualifiedName: qname,
        kind: mName === "constructor" ? "constructor" : "method",
        file, line: mStart, endLine: mEnd, language,
      };
      symbols.push(msym);
      scopes.push({ name: qname, startLine: mStart, endLine: mEnd, symbolId: msym.id });
    }
  }

  // Top-level function declarations
  for (const node of safeFindAll(root, "function_declaration")) {
    const nameNode = node.find({ rule: { kind: "identifier" } });
    if (!nameNode) continue;
    const name = nameNode.text();
    const r = node.range();
    const startLine = r.start.line + 1;
    const endLine = r.end.line + 1;
    const sym: SymbolNode = {
      id: makeId(file, name, startLine),
      name, qualifiedName: name, kind: "function", file, line: startLine, endLine, language,
    };
    symbols.push(sym);
    scopes.push({ name, startLine, endLine, symbolId: sym.id });
  }

  // Generator function declarations
  for (const node of safeFindAll(root, "generator_function_declaration")) {
    const nameNode = node.find({ rule: { kind: "identifier" } });
    if (!nameNode) continue;
    const name = nameNode.text();
    const r = node.range();
    const startLine = r.start.line + 1;
    const endLine = r.end.line + 1;
    const sym: SymbolNode = {
      id: makeId(file, name, startLine),
      name, qualifiedName: name, kind: "function", file, line: startLine, endLine, language,
    };
    symbols.push(sym);
    scopes.push({ name, startLine, endLine, symbolId: sym.id });
  }

  // Named arrow functions: `const foo = (...) => {...}` or `const foo = function(...) {...}`
  for (const node of safeFindAll(root, "lexical_declaration")) {
    for (const decl of safeFindAll(node, "variable_declarator")) {
      const idNode = decl.find({ rule: { kind: "identifier" } });
      if (!idNode) continue;
      const name = idNode.text();
      const arrow = decl.find({ rule: { kind: "arrow_function" } });
      const fnExpr = decl.find({ rule: { kind: "function_expression" } });
      const fn = arrow ?? fnExpr;
      if (!fn) continue;
      const r = fn.range();
      const startLine = r.start.line + 1;
      const endLine = r.end.line + 1;
      const sym: SymbolNode = {
        id: makeId(file, name, startLine),
        name, qualifiedName: name, kind: "function", file, line: startLine, endLine, language,
      };
      symbols.push(sym);
      scopes.push({ name, startLine, endLine, symbolId: sym.id });
    }
  }

  // Call sites
  const rawCalls: ExtractedSymbols["rawCalls"] = [];
  for (const node of safeFindAll(root, "call_expression")) {
    const calleeName = extractCalleeNameJs(node.text());
    if (!calleeName) continue;
    const r = node.range();
    const callLine = r.start.line + 1;
    const callerId = findCallerId(scopes, callLine, moduleSym.id);
    rawCalls.push({
      callerId, calleeName,
      callSite: { file, line: callLine },
    });
  }
  return { symbols, rawCalls };
}

/** Pull the callee's bare name from the start of a call expression's text. */
function extractCalleeNameJs(text: string): string | null {
  // `foo(...)` → "foo"  ;  `obj.foo(...)` → "foo"  ;  `obj.bar.foo(...)` → "foo"
  const m = text.match(/^([\w$.]+)\s*\(/);
  if (!m) return null;
  const chain = m[1];
  const parts = chain.split(".");
  const last = parts[parts.length - 1];
  return /^[A-Za-z_$][\w$]*$/.test(last) ? last : null;
}

// ── Python ───────────────────────────────────────────────────────────────

function extractFromPython(
  source: string,
  file: string,
  language: string,
  moduleSym: SymbolNode,
): ExtractedSymbols {
  const root = parse("python" as unknown as Lang, source).root();
  const symbols: SymbolNode[] = [moduleSym];
  const scopes: ScopeFrame[] = [];

  // Classes
  for (const cls of safeFindAll(root, "class_definition")) {
    const nameNode = cls.find({ rule: { kind: "identifier" } });
    if (!nameNode) continue;
    const className = nameNode.text();
    const r = cls.range();
    const startLine = r.start.line + 1;
    const endLine = r.end.line + 1;
    const csym: SymbolNode = {
      id: makeId(file, className, startLine),
      name: className, qualifiedName: className, kind: "class", file, line: startLine, endLine, language,
    };
    symbols.push(csym);
    scopes.push({ name: className, startLine, endLine, symbolId: csym.id });

    // Methods
    for (const fn of safeFindAll(cls, "function_definition")) {
      const fnName = fn.find({ rule: { kind: "identifier" } })?.text();
      if (!fnName) continue;
      const fr = fn.range();
      const fStart = fr.start.line + 1;
      const fEnd = fr.end.line + 1;
      const qname = `${className}.${fnName}`;
      const fsym: SymbolNode = {
        id: makeId(file, qname, fStart),
        name: fnName, qualifiedName: qname,
        kind: fnName === "__init__" ? "constructor" : "method",
        file, line: fStart, endLine: fEnd, language,
      };
      symbols.push(fsym);
      scopes.push({ name: qname, startLine: fStart, endLine: fEnd, symbolId: fsym.id });
    }
  }

  // Top-level functions (those not nested inside classes)
  for (const fn of safeFindAll(root, "function_definition")) {
    const fnName = fn.find({ rule: { kind: "identifier" } })?.text();
    if (!fnName) continue;
    const r = fn.range();
    const startLine = r.start.line + 1;
    // Skip if already captured as a method (start line matches an existing scope's nested method)
    if (symbols.some((s) => s.file === file && s.line === startLine && s.name === fnName)) continue;
    const endLine = r.end.line + 1;
    const sym: SymbolNode = {
      id: makeId(file, fnName, startLine),
      name: fnName, qualifiedName: fnName, kind: "function", file, line: startLine, endLine, language,
    };
    symbols.push(sym);
    scopes.push({ name: fnName, startLine, endLine, symbolId: sym.id });
  }

  // Calls
  const rawCalls: ExtractedSymbols["rawCalls"] = [];
  for (const node of safeFindAll(root, "call")) {
    const calleeName = extractCalleeNameJs(node.text());
    if (!calleeName) continue;
    const r = node.range();
    const callLine = r.start.line + 1;
    rawCalls.push({
      callerId: findCallerId(scopes, callLine, moduleSym.id),
      calleeName,
      callSite: { file, line: callLine },
    });
  }
  return { symbols, rawCalls };
}

// ── Go ───────────────────────────────────────────────────────────────────

function extractFromGo(
  source: string,
  file: string,
  language: string,
  moduleSym: SymbolNode,
): ExtractedSymbols {
  const root = parse("go" as unknown as Lang, source).root();
  const symbols: SymbolNode[] = [moduleSym];
  const scopes: ScopeFrame[] = [];

  for (const fn of safeFindAll(root, "function_declaration")) {
    const nameNode = fn.find({ rule: { kind: "identifier" } });
    if (!nameNode) continue;
    const name = nameNode.text();
    const r = fn.range();
    const startLine = r.start.line + 1;
    const endLine = r.end.line + 1;
    const sym: SymbolNode = {
      id: makeId(file, name, startLine),
      name, qualifiedName: name, kind: "function", file, line: startLine, endLine, language,
    };
    symbols.push(sym);
    scopes.push({ name, startLine, endLine, symbolId: sym.id });
  }
  for (const fn of safeFindAll(root, "method_declaration")) {
    const nameNode = fn.find({ rule: { kind: "field_identifier" } });
    if (!nameNode) continue;
    const name = nameNode.text();
    const r = fn.range();
    const startLine = r.start.line + 1;
    const endLine = r.end.line + 1;
    const sym: SymbolNode = {
      id: makeId(file, name, startLine),
      name, qualifiedName: name, kind: "method", file, line: startLine, endLine, language,
    };
    symbols.push(sym);
    scopes.push({ name, startLine, endLine, symbolId: sym.id });
  }

  const rawCalls: ExtractedSymbols["rawCalls"] = [];
  for (const node of safeFindAll(root, "call_expression")) {
    const calleeName = extractCalleeNameJs(node.text());
    if (!calleeName) continue;
    const r = node.range();
    const callLine = r.start.line + 1;
    rawCalls.push({
      callerId: findCallerId(scopes, callLine, moduleSym.id),
      calleeName, callSite: { file, line: callLine },
    });
  }
  return { symbols, rawCalls };
}

// ── Rust ─────────────────────────────────────────────────────────────────

function extractFromRust(
  source: string,
  file: string,
  language: string,
  moduleSym: SymbolNode,
): ExtractedSymbols {
  const root = parse("rust" as unknown as Lang, source).root();
  const symbols: SymbolNode[] = [moduleSym];
  const scopes: ScopeFrame[] = [];

  for (const fn of safeFindAll(root, "function_item")) {
    const nameNode = fn.find({ rule: { kind: "identifier" } });
    if (!nameNode) continue;
    const name = nameNode.text();
    const r = fn.range();
    const startLine = r.start.line + 1;
    const endLine = r.end.line + 1;
    const sym: SymbolNode = {
      id: makeId(file, name, startLine),
      name, qualifiedName: name, kind: "function", file, line: startLine, endLine, language,
    };
    symbols.push(sym);
    scopes.push({ name, startLine, endLine, symbolId: sym.id });
  }

  const rawCalls: ExtractedSymbols["rawCalls"] = [];
  for (const node of safeFindAll(root, "call_expression")) {
    const calleeName = extractCalleeNameJs(node.text());
    if (!calleeName) continue;
    const r = node.range();
    const callLine = r.start.line + 1;
    rawCalls.push({
      callerId: findCallerId(scopes, callLine, moduleSym.id),
      calleeName, callSite: { file, line: callLine },
    });
  }
  for (const node of safeFindAll(root, "macro_invocation")) {
    const nameNode = node.find({ rule: { kind: "identifier" } });
    if (!nameNode) continue;
    const r = node.range();
    const callLine = r.start.line + 1;
    rawCalls.push({
      callerId: findCallerId(scopes, callLine, moduleSym.id),
      calleeName: nameNode.text(), callSite: { file, line: callLine },
    });
  }
  return { symbols, rawCalls };
}

// ── JVM (Java / Kotlin / Scala) ──────────────────────────────────────────

function extractFromJvm(
  source: string,
  langKey: string,
  file: string,
  language: string,
  moduleSym: SymbolNode,
): ExtractedSymbols {
  const root = parse(langKey as unknown as Lang, source).root();
  const symbols: SymbolNode[] = [moduleSym];
  const scopes: ScopeFrame[] = [];

  const classKinds = langKey === "scala"
    ? ["class_definition", "object_definition", "trait_definition"]
    : ["class_declaration", "interface_declaration", "enum_declaration", "object_declaration"];
  for (const k of classKinds) {
    for (const cls of safeFindAll(root, k)) {
      const nameNode = cls.find({ rule: { kind: "type_identifier" } })
        ?? cls.find({ rule: { kind: "identifier" } });
      if (!nameNode) continue;
      const name = nameNode.text();
      const r = cls.range();
      const startLine = r.start.line + 1;
      const endLine = r.end.line + 1;
      const kind: SymbolKind = k.includes("interface") ? "interface"
        : k.includes("trait") ? "trait"
        : k.includes("enum") ? "enum" : "class";
      const sym: SymbolNode = {
        id: makeId(file, name, startLine),
        name, qualifiedName: name, kind, file, line: startLine, endLine, language,
      };
      symbols.push(sym);
      scopes.push({ name, startLine, endLine, symbolId: sym.id });
    }
  }

  const methodKinds = langKey === "scala"
    ? ["function_definition"]
    : langKey === "kotlin"
      ? ["function_declaration"]
      : ["method_declaration", "constructor_declaration"];
  for (const k of methodKinds) {
    for (const m of safeFindAll(root, k)) {
      const nameNode = m.find({ rule: { kind: "identifier" } })
        ?? m.find({ rule: { kind: "simple_identifier" } });
      if (!nameNode) continue;
      const name = nameNode.text();
      const r = m.range();
      const startLine = r.start.line + 1;
      const endLine = r.end.line + 1;
      const sym: SymbolNode = {
        id: makeId(file, name, startLine),
        name, qualifiedName: name,
        kind: k.includes("constructor") ? "constructor" : "method",
        file, line: startLine, endLine, language,
      };
      symbols.push(sym);
      scopes.push({ name, startLine, endLine, symbolId: sym.id });
    }
  }

  const callKinds = langKey === "java"
    ? ["method_invocation"]
    : ["call_expression"];
  const rawCalls: ExtractedSymbols["rawCalls"] = [];
  for (const k of callKinds) {
    for (const node of safeFindAll(root, k)) {
      const calleeName = extractCalleeNameJs(node.text());
      if (!calleeName) continue;
      const r = node.range();
      const callLine = r.start.line + 1;
      rawCalls.push({
        callerId: findCallerId(scopes, callLine, moduleSym.id),
        calleeName, callSite: { file, line: callLine },
      });
    }
  }
  return { symbols, rawCalls };
}

// ── C# ──────────────────────────────────────────────────────────────────

function extractFromCSharp(
  source: string,
  file: string,
  language: string,
  moduleSym: SymbolNode,
): ExtractedSymbols {
  const root = parse("csharp" as unknown as Lang, source).root();
  const symbols: SymbolNode[] = [moduleSym];
  const scopes: ScopeFrame[] = [];

  for (const k of ["class_declaration", "interface_declaration", "record_declaration", "struct_declaration"]) {
    for (const cls of safeFindAll(root, k)) {
      const nameNode = cls.find({ rule: { kind: "identifier" } });
      if (!nameNode) continue;
      const name = nameNode.text();
      const r = cls.range();
      const startLine = r.start.line + 1;
      const endLine = r.end.line + 1;
      const sym: SymbolNode = {
        id: makeId(file, name, startLine),
        name, qualifiedName: name,
        kind: k.includes("interface") ? "interface"
          : k.includes("struct") ? "struct" : "class",
        file, line: startLine, endLine, language,
      };
      symbols.push(sym);
      scopes.push({ name, startLine, endLine, symbolId: sym.id });
    }
  }
  for (const k of ["method_declaration", "constructor_declaration"]) {
    for (const m of safeFindAll(root, k)) {
      const nameNode = m.find({ rule: { kind: "identifier" } });
      if (!nameNode) continue;
      const name = nameNode.text();
      const r = m.range();
      const startLine = r.start.line + 1;
      const endLine = r.end.line + 1;
      const sym: SymbolNode = {
        id: makeId(file, name, startLine),
        name, qualifiedName: name,
        kind: k.includes("constructor") ? "constructor" : "method",
        file, line: startLine, endLine, language,
      };
      symbols.push(sym);
      scopes.push({ name, startLine, endLine, symbolId: sym.id });
    }
  }

  const rawCalls: ExtractedSymbols["rawCalls"] = [];
  for (const node of safeFindAll(root, "invocation_expression")) {
    const calleeName = extractCalleeNameJs(node.text());
    if (!calleeName) continue;
    const r = node.range();
    const callLine = r.start.line + 1;
    rawCalls.push({
      callerId: findCallerId(scopes, callLine, moduleSym.id),
      calleeName, callSite: { file, line: callLine },
    });
  }
  return { symbols, rawCalls };
}

// ── C / C++ ──────────────────────────────────────────────────────────────

function extractFromCFamily(
  source: string,
  langKey: string,
  file: string,
  language: string,
  moduleSym: SymbolNode,
): ExtractedSymbols {
  const root = parse(langKey as unknown as Lang, source).root();
  const symbols: SymbolNode[] = [moduleSym];
  const scopes: ScopeFrame[] = [];

  if (langKey === "cpp") {
    for (const k of ["class_specifier", "struct_specifier"]) {
      for (const cls of safeFindAll(root, k)) {
        const nameNode = cls.find({ rule: { kind: "type_identifier" } });
        if (!nameNode) continue;
        const name = nameNode.text();
        const r = cls.range();
        const startLine = r.start.line + 1;
        const endLine = r.end.line + 1;
        const sym: SymbolNode = {
          id: makeId(file, name, startLine),
          name, qualifiedName: name,
          kind: k.includes("struct") ? "struct" : "class",
          file, line: startLine, endLine, language,
        };
        symbols.push(sym);
        scopes.push({ name, startLine, endLine, symbolId: sym.id });
      }
    }
  }

  for (const fn of safeFindAll(root, "function_definition")) {
    const declarator = fn.find({ rule: { kind: "function_declarator" } });
    const nameNode = declarator?.find({ rule: { kind: "identifier" } })
      ?? declarator?.find({ rule: { kind: "qualified_identifier" } });
    if (!nameNode) continue;
    const fullName = nameNode.text();
    const name = fullName.split("::").pop() ?? fullName;
    const r = fn.range();
    const startLine = r.start.line + 1;
    const endLine = r.end.line + 1;
    const sym: SymbolNode = {
      id: makeId(file, fullName, startLine),
      name, qualifiedName: fullName,
      kind: fullName.includes("::") ? "method" : "function",
      file, line: startLine, endLine, language,
    };
    symbols.push(sym);
    scopes.push({ name: fullName, startLine, endLine, symbolId: sym.id });
  }

  const rawCalls: ExtractedSymbols["rawCalls"] = [];
  for (const node of safeFindAll(root, "call_expression")) {
    const calleeName = extractCalleeNameJs(node.text());
    if (!calleeName) continue;
    const r = node.range();
    const callLine = r.start.line + 1;
    rawCalls.push({
      callerId: findCallerId(scopes, callLine, moduleSym.id),
      calleeName, callSite: { file, line: callLine },
    });
  }
  return { symbols, rawCalls };
}

// ── Ruby ────────────────────────────────────────────────────────────────

function extractFromRuby(
  source: string,
  file: string,
  language: string,
  moduleSym: SymbolNode,
): ExtractedSymbols {
  const root = parse("ruby" as unknown as Lang, source).root();
  const symbols: SymbolNode[] = [moduleSym];
  const scopes: ScopeFrame[] = [];

  for (const k of ["class", "module"]) {
    for (const cls of safeFindAll(root, k)) {
      const nameNode = cls.find({ rule: { kind: "constant" } })
        ?? cls.find({ rule: { kind: "identifier" } });
      if (!nameNode) continue;
      const name = nameNode.text();
      const r = cls.range();
      const startLine = r.start.line + 1;
      const endLine = r.end.line + 1;
      const sym: SymbolNode = {
        id: makeId(file, name, startLine),
        name, qualifiedName: name,
        kind: k === "module" ? "module" : "class",
        file, line: startLine, endLine, language,
      };
      symbols.push(sym);
      scopes.push({ name, startLine, endLine, symbolId: sym.id });
    }
  }
  for (const m of safeFindAll(root, "method")) {
    const nameNode = m.find({ rule: { kind: "identifier" } });
    if (!nameNode) continue;
    const name = nameNode.text();
    const r = m.range();
    const startLine = r.start.line + 1;
    const endLine = r.end.line + 1;
    const sym: SymbolNode = {
      id: makeId(file, name, startLine),
      name, qualifiedName: name, kind: "method",
      file, line: startLine, endLine, language,
    };
    symbols.push(sym);
    scopes.push({ name, startLine, endLine, symbolId: sym.id });
  }

  const rawCalls: ExtractedSymbols["rawCalls"] = [];
  for (const node of safeFindAll(root, "call")) {
    const calleeName = extractCalleeNameJs(node.text());
    if (!calleeName) continue;
    const r = node.range();
    const callLine = r.start.line + 1;
    rawCalls.push({
      callerId: findCallerId(scopes, callLine, moduleSym.id),
      calleeName, callSite: { file, line: callLine },
    });
  }
  return { symbols, rawCalls };
}

// ── PHP ─────────────────────────────────────────────────────────────────

function extractFromPhp(
  source: string,
  file: string,
  language: string,
  moduleSym: SymbolNode,
): ExtractedSymbols {
  const root = parse("php" as unknown as Lang, source).root();
  const symbols: SymbolNode[] = [moduleSym];
  const scopes: ScopeFrame[] = [];

  for (const k of ["class_declaration", "interface_declaration", "trait_declaration"]) {
    for (const cls of safeFindAll(root, k)) {
      const nameNode = cls.find({ rule: { kind: "name" } });
      if (!nameNode) continue;
      const name = nameNode.text();
      const r = cls.range();
      const startLine = r.start.line + 1;
      const endLine = r.end.line + 1;
      const sym: SymbolNode = {
        id: makeId(file, name, startLine),
        name, qualifiedName: name,
        kind: k.includes("interface") ? "interface" : k.includes("trait") ? "trait" : "class",
        file, line: startLine, endLine, language,
      };
      symbols.push(sym);
      scopes.push({ name, startLine, endLine, symbolId: sym.id });
    }
  }
  for (const k of ["function_definition", "method_declaration"]) {
    for (const m of safeFindAll(root, k)) {
      const nameNode = m.find({ rule: { kind: "name" } });
      if (!nameNode) continue;
      const name = nameNode.text();
      const r = m.range();
      const startLine = r.start.line + 1;
      const endLine = r.end.line + 1;
      const sym: SymbolNode = {
        id: makeId(file, name, startLine),
        name, qualifiedName: name,
        kind: k === "function_definition" ? "function" : "method",
        file, line: startLine, endLine, language,
      };
      symbols.push(sym);
      scopes.push({ name, startLine, endLine, symbolId: sym.id });
    }
  }

  const rawCalls: ExtractedSymbols["rawCalls"] = [];
  for (const k of ["function_call_expression", "member_call_expression", "scoped_call_expression"]) {
    for (const node of safeFindAll(root, k)) {
      const calleeName = extractCalleeNameJs(node.text());
      if (!calleeName) continue;
      const r = node.range();
      const callLine = r.start.line + 1;
      rawCalls.push({
        callerId: findCallerId(scopes, callLine, moduleSym.id),
        calleeName, callSite: { file, line: callLine },
      });
    }
  }
  return { symbols, rawCalls };
}

// ── Swift ───────────────────────────────────────────────────────────────

function extractFromSwift(
  source: string,
  file: string,
  language: string,
  moduleSym: SymbolNode,
): ExtractedSymbols {
  const root = parse("swift" as unknown as Lang, source).root();
  const symbols: SymbolNode[] = [moduleSym];
  const scopes: ScopeFrame[] = [];

  for (const k of ["class_declaration", "struct_declaration", "protocol_declaration", "enum_declaration"]) {
    for (const cls of safeFindAll(root, k)) {
      const nameNode = cls.find({ rule: { kind: "type_identifier" } })
        ?? cls.find({ rule: { kind: "identifier" } });
      if (!nameNode) continue;
      const name = nameNode.text();
      const r = cls.range();
      const startLine = r.start.line + 1;
      const endLine = r.end.line + 1;
      const sym: SymbolNode = {
        id: makeId(file, name, startLine),
        name, qualifiedName: name,
        kind: k.includes("struct") ? "struct"
          : k.includes("protocol") ? "interface"
          : k.includes("enum") ? "enum" : "class",
        file, line: startLine, endLine, language,
      };
      symbols.push(sym);
      scopes.push({ name, startLine, endLine, symbolId: sym.id });
    }
  }
  for (const fn of safeFindAll(root, "function_declaration")) {
    const nameNode = fn.find({ rule: { kind: "simple_identifier" } })
      ?? fn.find({ rule: { kind: "identifier" } });
    if (!nameNode) continue;
    const name = nameNode.text();
    const r = fn.range();
    const startLine = r.start.line + 1;
    const endLine = r.end.line + 1;
    const sym: SymbolNode = {
      id: makeId(file, name, startLine),
      name, qualifiedName: name, kind: "function",
      file, line: startLine, endLine, language,
    };
    symbols.push(sym);
    scopes.push({ name, startLine, endLine, symbolId: sym.id });
  }

  const rawCalls: ExtractedSymbols["rawCalls"] = [];
  for (const node of safeFindAll(root, "call_expression")) {
    const calleeName = extractCalleeNameJs(node.text());
    if (!calleeName) continue;
    const r = node.range();
    const callLine = r.start.line + 1;
    rawCalls.push({
      callerId: findCallerId(scopes, callLine, moduleSym.id),
      calleeName, callSite: { file, line: callLine },
    });
  }
  return { symbols, rawCalls };
}

// ── Bash ────────────────────────────────────────────────────────────────

function extractFromBash(
  source: string,
  file: string,
  language: string,
  moduleSym: SymbolNode,
): ExtractedSymbols {
  const root = parse("bash" as unknown as Lang, source).root();
  const symbols: SymbolNode[] = [moduleSym];
  const scopes: ScopeFrame[] = [];

  for (const fn of safeFindAll(root, "function_definition")) {
    const nameNode = fn.find({ rule: { kind: "word" } });
    if (!nameNode) continue;
    const name = nameNode.text();
    const r = fn.range();
    const startLine = r.start.line + 1;
    const endLine = r.end.line + 1;
    const sym: SymbolNode = {
      id: makeId(file, name, startLine),
      name, qualifiedName: name, kind: "function",
      file, line: startLine, endLine, language,
    };
    symbols.push(sym);
    scopes.push({ name, startLine, endLine, symbolId: sym.id });
  }

  const rawCalls: ExtractedSymbols["rawCalls"] = [];
  for (const node of safeFindAll(root, "command")) {
    const nameNode = node.find({ rule: { kind: "command_name" } });
    if (!nameNode) continue;
    const name = nameNode.text();
    if (!/^[A-Za-z_][\w]*$/.test(name)) continue;
    const r = node.range();
    const callLine = r.start.line + 1;
    rawCalls.push({
      callerId: findCallerId(scopes, callLine, moduleSym.id),
      calleeName: name, callSite: { file, line: callLine },
    });
  }
  return { symbols, rawCalls };
}

// ── Regex fallback (Dart, Lua, Svelte/Vue, anything unsupported) ────────

function extractFromRegex(
  source: string,
  file: string,
  language: string,
  moduleSym: SymbolNode,
): ExtractedSymbols {
  const symbols: SymbolNode[] = [moduleSym];
  const scopes: ScopeFrame[] = [];
  const lines = source.split("\n");

  // Generic `function NAME` / `def NAME` / `fn NAME` / `func NAME` patterns
  const fnRegex = /^\s*(?:export\s+|public\s+|private\s+|static\s+|async\s+)*(?:function|def|fn|func|sub|local\s+function)\s+([A-Za-z_][\w]*)/;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(fnRegex);
    if (!m) continue;
    const name = m[1];
    const startLine = i + 1;
    // Heuristic end line: next line with same or less indentation
    const indent = lines[i].match(/^\s*/)?.[0].length ?? 0;
    let endLine = startLine;
    for (let j = i + 1; j < lines.length; j++) {
      const text = lines[j];
      if (text.trim() === "") continue;
      const ind = text.match(/^\s*/)?.[0].length ?? 0;
      if (ind <= indent) break;
      endLine = j + 1;
    }
    const sym: SymbolNode = {
      id: makeId(file, name, startLine),
      name, qualifiedName: name, kind: "function",
      file, line: startLine, endLine, language,
    };
    symbols.push(sym);
    scopes.push({ name, startLine, endLine, symbolId: sym.id });
  }

  const rawCalls: ExtractedSymbols["rawCalls"] = [];
  const callRegex = /([A-Za-z_][\w]*)\s*\(/g;
  for (let i = 0; i < lines.length; i++) {
    let m: RegExpExecArray | null = null;
    callRegex.lastIndex = 0;
    m = callRegex.exec(lines[i]);
    while (m !== null) {
      const name = m[1];
      // Skip language keywords/control flow
      if (!["if", "for", "while", "switch", "return", "function", "def", "fn", "func", "class", "new"].includes(name)) {
        const callLine = i + 1;
        rawCalls.push({
          callerId: findCallerId(scopes, callLine, moduleSym.id),
        calleeName: name, callSite: { file, line: callLine },
      });
      }
      m = callRegex.exec(lines[i]);
    }
  }
  return { symbols, rawCalls };
}

/** Convert raw call sites to unresolved SymbolEdge objects (resolution in Phase C). */
export function rawCallsToUnresolvedEdges(
  rawCalls: ExtractedSymbols["rawCalls"],
): SymbolEdge[] {
  return rawCalls.map((c) => ({
    callerId: c.callerId,
    calleeName: c.calleeName,
    calleeCandidates: [],
    confidence: "unresolved" as const,
    callSite: c.callSite,
  }));
}
