// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited
export interface FileChunk {
  id: string;
  filePath: string;
  relativePath: string;
  content: string;
  startLine: number;
  endLine: number;
  language: string;
  type: "code" | "comment" | "mixed";
}

export interface CodeGraphNode {
  filePath: string;
  relativePath: string;
  imports: string[];
  exports: string[];
  dependencies: string[];
  dependents: string[];
}

export interface CodeGraphEdge {
  source: string;
  target: string;
  type: "import" | "re-export" | "dynamic-import";
}

export interface CodeGraph {
  nodes: CodeGraphNode[];
  edges: CodeGraphEdge[];
}

export interface SearchResult {
  filePath: string;
  relativePath: string;
  content: string;
  startLine: number;
  endLine: number;
  language: string;
  score: number;
  /** Source project label (set when searching across multiple collections) */
  project?: string;
}

export interface HealthStatus {
  docker: boolean;
  ollama: boolean;
  qdrant: boolean;
  ollamaModel: boolean;
  qdrantImage: boolean;
  ollamaImage: boolean;
}

/** A context artifact defined in .socraticodecontextartifacts.json */
export interface ContextArtifact {
  /** Unique name for this artifact (e.g. "database-schema") */
  name: string;
  /** Path to the file or directory (relative to project root or absolute) */
  path: string;
  /** Human-readable description explaining what this artifact is and how the AI should use it */
  description: string;
}

/** Runtime state of an indexed artifact */
export interface ArtifactIndexState {
  name: string;
  description: string;
  /** Resolved absolute path */
  resolvedPath: string;
  /** Content hash at the time of last indexing */
  contentHash: string;
  /** ISO timestamp of last indexing */
  lastIndexedAt: string;
  /** Number of chunks stored */
  chunksIndexed: number;
}

// ── Symbol-level call graph (Impact Analysis) ────────────────────────────

/** Kinds of symbols extracted from source code */
export type SymbolKind =
  | "function"
  | "class"
  | "method"
  | "constructor"
  | "interface"
  | "trait"
  | "enum"
  | "module"
  | "struct"
  | "variable";

/** A single symbol (definition) extracted from source code */
export interface SymbolNode {
  /** Stable id: `${relativePath}::${qualifiedName}#${line}` */
  id: string;
  /** Unqualified name (e.g. "validateUser") */
  name: string;
  /** Qualified name (e.g. "Auth.validateUser") when nested in a class/module */
  qualifiedName: string;
  kind: SymbolKind;
  /** Relative path */
  file: string;
  /** 1-based line number of the definition start */
  line: number;
  /** 1-based line number of the definition end */
  endLine: number;
  /** Re-export alias, if any */
  exportedAs?: string;
  language: string;
}

/** Confidence level for a resolved call edge */
export type SymbolEdgeConfidence =
  | "local"
  | "unique"
  | "multiple-candidates"
  | "unresolved";

/** A call-site edge between symbols */
export interface SymbolEdge {
  /** SymbolNode.id of the caller */
  callerId: string;
  /** Raw name at the call site (e.g. "foo" in "foo()") */
  calleeName: string;
  /** Resolved SymbolNode.ids: 0 = external, 1 = unique, >1 = ambiguous */
  calleeCandidates: string[];
  confidence: SymbolEdgeConfidence;
  callSite: { file: string; line: number };
}

/** Lightweight reference to a symbol (used by name index) */
export interface SymbolRef {
  /** Relative file path containing the symbol */
  file: string;
  /** SymbolNode.id */
  id: string;
}

/** Top-level metadata for a project's symbol graph */
export interface SymbolGraphMeta {
  projectId: string;
  symbolCount: number;
  edgeCount: number;
  fileCount: number;
  unresolvedEdgePct: number;
  builtAt: number;
  schemaVersion: 1;
}

/** Per-file payload stored in `_symgraph_file` */
export interface SymbolGraphFilePayload {
  /** Relative path */
  file: string;
  language: string;
  /** SHA-256 of source bytes for staleness detection */
  contentHash: string;
  symbols: SymbolNode[];
  /** Edges whose caller is in this file */
  outgoingCalls: SymbolEdge[];
}

/** Detected entry point with reason */
export interface EntryPoint {
  /** SymbolNode.id, or relative file path for orphan-file entries */
  id: string;
  /** Display name */
  name: string;
  file: string;
  line?: number;
  /** Reason categorisation (e.g. "orphan", "well-known-name:main", "framework:express-get") */
  reason: string;
}
