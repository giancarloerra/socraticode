// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited
/**
 * OpenAI embedding provider.
 *
 * Uses the OpenAI Embeddings API (text-embedding-3-small by default).
 *
 * Required env:
 *   EMBEDDING_PROVIDER=openai
 *   OPENAI_API_KEY=sk-...
 *
 * Optional env:
 *   EMBEDDING_MODEL=text-embedding-3-small  (default)
 *   EMBEDDING_DIMENSIONS=1536               (default for text-embedding-3-small)
 */

import OpenAI from "openai";
import { getEmbeddingConfig } from "./embedding-config.js";
import type { EmbeddingHealthStatus, EmbeddingProvider, EmbeddingReadinessResult } from "./embedding-types.js";
import { logger } from "./logger.js";

// ── Constants ───────────────────────────────────────────────────────────

/**
 * OpenAI embeddings API accepts up to 2048 inputs per request,
 * but we use a conservative batch size to stay within rate limits.
 */
const OPENAI_BATCH_SIZE = 512;

/** Max input tokens for OpenAI embedding models (8191 for text-embedding-3-*). */
const OPENAI_MAX_TOKENS = 8191;

/**
 * Conservative chars-per-token estimate for code.
 * OpenAI tokenizers average ~4 chars/token for English,
 * but code has more single-char tokens. Using 3.0 for safety.
 */
const CHARS_PER_TOKEN_ESTIMATE = 3.0;

// ── Client management ───────────────────────────────────────────────────

let openaiClient: OpenAI | null = null;

function getClient(): OpenAI {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "OPENAI_API_KEY environment variable is required when using the OpenAI embedding provider. " +
        "Set it in your MCP config env block.",
      );
    }
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

/** Reset client (for testing). */
export function resetOpenAIClient(): void {
  openaiClient = null;
}

// ── Pre-truncation ──────────────────────────────────────────────────────

function pretruncateTexts(texts: string[], contextLength: number): string[] {
  if (contextLength <= 0) return texts;
  const maxChars = Math.floor(contextLength * CHARS_PER_TOKEN_ESTIMATE);
  return texts.map((t) => (t.length > maxChars ? t.substring(0, maxChars) : t));
}

// ── Provider class ──────────────────────────────────────────────────────

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly name = "openai";

  async ensureReady(): Promise<EmbeddingReadinessResult> {
    // Validate API key is present
    getClient();

    // Verify connectivity with a minimal request
    try {
      const client = getClient();
      await client.models.list();
      logger.info("OpenAI embedding provider ready", {
        model: getEmbeddingConfig().embeddingModel,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`OpenAI API is not reachable: ${message}`);
    }

    // Cloud providers don't pull models / start containers
    return { modelPulled: false, containerStarted: false, imagePulled: false };
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const config = getEmbeddingConfig();
    const client = getClient();
    const truncated = pretruncateTexts(texts, config.embeddingContextLength || OPENAI_MAX_TOKENS);

    // OpenAI supports batching natively — send all at once if within limits
    if (truncated.length <= OPENAI_BATCH_SIZE) {
      return this._embedBatch(client, truncated, config.embeddingModel, config.embeddingDimensions);
    }

    // Split into sub-batches
    const results: number[][] = [];
    for (let i = 0; i < truncated.length; i += OPENAI_BATCH_SIZE) {
      const batch = truncated.slice(i, i + OPENAI_BATCH_SIZE);
      const embeddings = await this._embedBatch(client, batch, config.embeddingModel, config.embeddingDimensions);
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

    const hasKey = !!process.env.OPENAI_API_KEY;
    lines.push(`${icon(hasKey)} OpenAI API key: ${hasKey ? "Configured" : "Missing — set OPENAI_API_KEY in your MCP config"}`);

    if (!hasKey) {
      return { available: false, modelReady: false, statusLines: lines };
    }

    try {
      const client = getClient();
      await client.models.list();
      lines.push(`${icon(true)} OpenAI API: Reachable`);
      lines.push(`${icon(true)} Embedding model: ${config.embeddingModel}`);
      return { available: true, modelReady: true, statusLines: lines };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      lines.push(`${icon(false)} OpenAI API: ${message}`);
      return { available: false, modelReady: false, statusLines: lines };
    }
  }

  private async _embedBatch(
    client: OpenAI,
    texts: string[],
    model: string,
    dimensions: number,
  ): Promise<number[][]> {
    const supportsDimensions = model.startsWith("text-embedding-3");
    const response = await client.embeddings.create({
      model,
      input: texts,
      ...(supportsDimensions ? { dimensions } : {}),
    });

    // OpenAI returns embeddings sorted by index, but we ensure order
    const sorted = response.data.sort((a, b) => a.index - b.index);
    return sorted.map((d) => d.embedding);
  }
}
