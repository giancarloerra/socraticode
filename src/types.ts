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
