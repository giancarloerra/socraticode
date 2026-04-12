// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited
/**
 * Google Generative AI embedding provider.
 *
 * Uses the Gemini Embedding API (gemini-embedding-001 by default, 3072 dims).
 *
 * Required env:
 *   EMBEDDING_PROVIDER=google
 *   GOOGLE_API_KEY=AIza...
 *
 * Optional env:
 *   EMBEDDING_MODEL=gemini-embedding-001    (default)
 *   EMBEDDING_DIMENSIONS=3072               (default for gemini-embedding-001)
 */

import { type GenerativeModel, GoogleGenerativeAI } from "@google/generative-ai";
import { getEmbeddingConfig } from "./embedding-config.js";
import type { EmbeddingHealthStatus, EmbeddingProvider, EmbeddingReadinessResult } from "./embedding-types.js";
import { logger } from "./logger.js";

// ── Constants ───────────────────────────────────────────────────────────

/**
 * Google batchEmbedContents supports up to 100 texts per request.
 */
const GOOGLE_BATCH_SIZE = 100;

/** Max input tokens for gemini-embedding-001 (2048 tokens). */
const GOOGLE_MAX_TOKENS = 2048;

/**
 * Conservative chars-per-token estimate for code.
 * Using 3.0 for safety (Google uses SentencePiece tokenizer, similar ratio to BPE).
 */
const CHARS_PER_TOKEN_ESTIMATE = 3.0;

// ── Client management ───────────────────────────────────────────────────

let googleClient: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI {
  if (!googleClient) {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      throw new Error(
        "GOOGLE_API_KEY environment variable is required when using the Google embedding provider. " +
        "Set it in your MCP config env block.",
      );
    }
    googleClient = new GoogleGenerativeAI(apiKey);
  }
  return googleClient;
}

/** Reset client (for testing). */
export function resetGoogleClient(): void {
  googleClient = null;
}

// ── Pre-truncation ──────────────────────────────────────────────────────

function pretruncateTexts(texts: string[], contextLength: number): string[] {
  if (contextLength <= 0) return texts;
  const maxChars = Math.floor(contextLength * CHARS_PER_TOKEN_ESTIMATE);
  return texts.map((t) => (t.length > maxChars ? t.substring(0, maxChars) : t));
}

// ── Provider class ──────────────────────────────────────────────────────

export class GoogleEmbeddingProvider implements EmbeddingProvider {
  readonly name = "google";

  async ensureReady(): Promise<EmbeddingReadinessResult> {
    // Validate API key is present
    getClient();

    // Verify connectivity with a minimal embedding request
    try {
      const config = getEmbeddingConfig();
      const client = getClient();
      const model = client.getGenerativeModel({ model: config.embeddingModel });
      await model.embedContent("test");
      logger.info("Google embedding provider ready", {
        model: config.embeddingModel,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Google Generative AI API is not reachable: ${message}`);
    }

    return { modelPulled: false, containerStarted: false, imagePulled: false };
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const config = getEmbeddingConfig();
    const client = getClient();
    const truncated = pretruncateTexts(texts, config.embeddingContextLength || GOOGLE_MAX_TOKENS);
    const model = client.getGenerativeModel({ model: config.embeddingModel });

    // Use batchEmbedContents for efficiency
    if (truncated.length <= GOOGLE_BATCH_SIZE) {
      return this._embedBatch(model, truncated);
    }

    // Split into sub-batches
    const results: number[][] = [];
    for (let i = 0; i < truncated.length; i += GOOGLE_BATCH_SIZE) {
      const batch = truncated.slice(i, i + GOOGLE_BATCH_SIZE);
      const embeddings = await this._embedBatch(model, batch);
      results.push(...embeddings);
    }
    return results;
  }

  async embedSingle(text: string): Promise<number[]> {
    const results = await this.embed([text]);
    if (results.length === 0) {
      throw new Error("Embedding failed: no result returned");
    }
    return results[0];
  }

  async healthCheck(): Promise<EmbeddingHealthStatus> {
    const config = getEmbeddingConfig();
    const lines: string[] = [];
    const icon = (ok: boolean) => (ok ? "[OK]" : "[MISSING]");

    const hasKey = !!process.env.GOOGLE_API_KEY;
    lines.push(`${icon(hasKey)} Google API key: ${hasKey ? "Configured" : "Missing — set GOOGLE_API_KEY in your MCP config"}`);

    if (!hasKey) {
      return { available: false, modelReady: false, statusLines: lines };
    }

    try {
      const client = getClient();
      const model = client.getGenerativeModel({ model: config.embeddingModel });
      await model.embedContent("health check");
      lines.push(`${icon(true)} Google Generative AI API: Reachable`);
      lines.push(`${icon(true)} Embedding model: ${config.embeddingModel}`);
      return { available: true, modelReady: true, statusLines: lines };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      lines.push(`${icon(false)} Google Generative AI API: ${message}`);
      return { available: false, modelReady: false, statusLines: lines };
    }
  }

  private async _embedBatch(model: GenerativeModel, texts: string[]): Promise<number[][]> {
    const requests = texts.map((text) => ({
      content: { role: "user" as const, parts: [{ text }] },
    }));

    const response = await model.batchEmbedContents({ requests });
    return response.embeddings.map((e: { values: number[] }) => e.values);
  }
}
