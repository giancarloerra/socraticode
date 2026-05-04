// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited
/**
 * LM Studio embedding provider.
 *
 * LM Studio's Local Server exposes an OpenAI-compatible /v1/embeddings endpoint,
 * so we reuse the OpenAI SDK with a custom baseURL. This provider is intentionally
 * separate from `provider-openai.ts` because:
 *   - LM Studio runs locally with no auth by default; OpenAI is cloud-only and requires a key.
 *   - LM Studio models have no Matryoshka support, so we never send a `dimensions` parameter.
 *   - Health check messaging, defaults, and error guidance differ meaningfully.
 *
 * Required env when using this provider:
 *   EMBEDDING_PROVIDER=lmstudio
 *   EMBEDDING_MODEL=<model-id-from-LM-Studio-Local-Server-tab>
 *   EMBEDDING_DIMENSIONS=<dim-of-loaded-model>
 *
 * Optional env:
 *   LMSTUDIO_URL=http://localhost:1234/v1   (default)
 *   LMSTUDIO_API_KEY=<key>                  (only if you've enabled API key auth in LM Studio)
 *   EMBEDDING_CONTEXT_LENGTH=<tokens>       (defaults to 2048 if model unknown)
 */

import OpenAI from "openai";
import { getEmbeddingConfig } from "./embedding-config.js";
import type { EmbeddingHealthStatus, EmbeddingProvider, EmbeddingReadinessResult } from "./embedding-types.js";
import { logger } from "./logger.js";

// ── Constants ───────────────────────────────────────────────────────────

/**
 * Conservative batch size — LM Studio runs locally and is bound by VRAM,
 * not API rate limits. Large batches risk OOM with 7B+ embedding models.
 * Tune via implementation if you have specific hardware headroom.
 */
const LMSTUDIO_BATCH_SIZE = 64;

/**
 * Conservative chars-per-token ratio for code. Same value used by provider-openai
 * (LM Studio uses the same tokenizers for OpenAI-compat models in most cases).
 */
const CHARS_PER_TOKEN_ESTIMATE = 3.0;

/**
 * Fallback context length when EMBEDDING_CONTEXT_LENGTH is unset and the model
 * is not in the known-models table. LM Studio embedding models commonly support
 * 512–32768 tokens; 2048 is a safe lower bound that won't blow up for any
 * mainstream model.
 */
const DEFAULT_CONTEXT_LENGTH = 2048;

// ── Client management ───────────────────────────────────────────────────

let lmstudioClient: OpenAI | null = null;
let lmstudioBaseUrl: string | null = null;

function getClient(): OpenAI {
  const config = getEmbeddingConfig();
  const baseUrl = config.lmstudioUrl;
  if (!lmstudioClient || lmstudioBaseUrl !== baseUrl) {
    lmstudioClient = new OpenAI({
      // LM Studio doesn't validate the key by default. We send a non-empty placeholder
      // because the OpenAI SDK throws if apiKey is empty/undefined. Users who enable
      // API key auth in LM Studio's Local Server should set LMSTUDIO_API_KEY.
      apiKey: process.env.LMSTUDIO_API_KEY || "lm-studio",
      baseURL: baseUrl,
    });
    lmstudioBaseUrl = baseUrl;
  }
  return lmstudioClient;
}

/** Reset client (for testing or LMSTUDIO_URL hot-swap). */
export function resetLMStudioClient(): void {
  lmstudioClient = null;
  lmstudioBaseUrl = null;
}

// ── Pre-truncation ──────────────────────────────────────────────────────

function pretruncateTexts(texts: string[], contextLength: number): string[] {
  if (contextLength <= 0) return texts;
  const maxChars = Math.floor(contextLength * CHARS_PER_TOKEN_ESTIMATE);
  return texts.map((t) => (t.length > maxChars ? t.substring(0, maxChars) : t));
}

// ── Provider class ──────────────────────────────────────────────────────

export class LMStudioEmbeddingProvider implements EmbeddingProvider {
  readonly name = "lmstudio";

  async ensureReady(): Promise<EmbeddingReadinessResult> {
    const config = getEmbeddingConfig();
    const client = getClient();

    // Step 1 — connectivity. The Local Server might be off, the port might be wrong,
    // or LM Studio itself might not be running. Surface those as a single actionable
    // message before checking model load state.
    let modelList: Awaited<ReturnType<typeof client.models.list>>;
    try {
      modelList = await client.models.list();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `LM Studio is not reachable at ${config.lmstudioUrl}. ` +
        "Make sure LM Studio is running and the Local Server is started " +
        "(Local Server tab > Start Server). " +
        "If you've changed the port, set LMSTUDIO_URL accordingly (e.g. http://localhost:5678/v1). " +
        `Underlying error: ${message}`,
      );
    }

    // Step 2 — model loaded. LM Studio's /v1/models lists the currently-loaded
    // models; if the configured EMBEDDING_MODEL isn't there, every embed() call
    // will fail server-side with an opaque error. Fail early with a distinct,
    // actionable message instead.
    const modelLoaded = modelList.data.some((m) => m.id === config.embeddingModel);
    if (!modelLoaded) {
      throw new Error(
        `LM Studio is reachable at ${config.lmstudioUrl} but the embedding model ` +
        `"${config.embeddingModel}" is not loaded. Open LM Studio's Local Server tab, ` +
        "load the model, and select it as the active embedding model — then retry. " +
        "(Use EMBEDDING_MODEL to match the exact model identifier shown in LM Studio.)",
      );
    }

    logger.info("LM Studio embedding provider ready", {
      baseUrl: config.lmstudioUrl,
      model: config.embeddingModel,
    });
    // LM Studio is user-managed — no containers, no model pulls.
    return { modelPulled: false, containerStarted: false, imagePulled: false };
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const config = getEmbeddingConfig();
    const client = getClient();
    const contextLength = config.embeddingContextLength > 0
      ? config.embeddingContextLength
      : DEFAULT_CONTEXT_LENGTH;
    const truncated = pretruncateTexts(texts, contextLength);

    if (truncated.length <= LMSTUDIO_BATCH_SIZE) {
      return this._embedBatch(client, truncated, config.embeddingModel);
    }

    const results: number[][] = [];
    for (let i = 0; i < truncated.length; i += LMSTUDIO_BATCH_SIZE) {
      const batch = truncated.slice(i, i + LMSTUDIO_BATCH_SIZE);
      const embeddings = await this._embedBatch(client, batch, config.embeddingModel);
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

    try {
      const client = getClient();
      const models = await client.models.list();
      lines.push(`${icon(true)} LM Studio: Reachable at ${config.lmstudioUrl}`);

      // LM Studio /v1/models returns the list of currently-loaded models.
      // If our embedding model isn't in that list, it likely isn't loaded.
      const modelLoaded = models.data.some((m) => m.id === config.embeddingModel);
      lines.push(
        `${icon(modelLoaded)} Embedding model (${config.embeddingModel}): ` +
        (modelLoaded
          ? "Loaded"
          : "Not loaded — load it in LM Studio's Local Server tab and select it as the active model"),
      );

      return { available: true, modelReady: modelLoaded, statusLines: lines };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      lines.push(`${icon(false)} LM Studio: Not reachable at ${config.lmstudioUrl} (${message})`);
      return { available: false, modelReady: false, statusLines: lines };
    }
  }

  private async _embedBatch(
    client: OpenAI,
    texts: string[],
    model: string,
  ): Promise<number[][]> {
    // No `dimensions` parameter: LM Studio doesn't implement Matryoshka projection.
    // The model returns its native dimension and we trust the user to have set
    // EMBEDDING_DIMENSIONS to match.
    //
    // `encoding_format: "float"` is REQUIRED. The OpenAI SDK (6.x+) defaults to
    // `encoding_format: "base64"` for performance, then unconditionally decodes the
    // response with toFloat32Array(). LM Studio ignores `encoding_format` and always
    // returns a plain JSON array of floats. The SDK's decode path then runs
    // `Buffer.from(<array>, 'base64')` — Node.js silently drops the encoding for
    // array inputs and clamps each float (<1.0) to uint8 0, producing a 4096-byte
    // zero buffer that gets reinterpreted as a 1024-element Float32Array of zeros.
    // Setting `encoding_format: "float"` makes the SDK skip the decode step entirely
    // (see openai-node/src/resources/embeddings.ts: `if (hasUserProvidedEncodingFormat)`).
    const response = await client.embeddings.create({
      model,
      input: texts,
      encoding_format: "float",
    });
    const sorted = response.data.sort((a, b) => a.index - b.index);
    return sorted.map((d) => d.embedding);
  }
}
