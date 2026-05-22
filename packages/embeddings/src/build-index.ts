/* SPDX-License-Identifier: Apache-2.0 */
import type { SemanticLayer } from "@arivie/semantic";
import type { MastraVector } from "@mastra/core/vector";
import { embedMany } from "ai";
import { ParagraphChunker } from "./chunker.js";
import type {
  BuildIndexResult,
  Chunker,
  EmbeddingProvider,
} from "./types.js";

const DEFAULT_BATCH_SIZE = 96;

/** Postgres / Mastra "index already exists" — swallow only this case for idempotent createIndex. */
const INDEX_ALREADY_EXISTS = /already exists/i;

function isIndexAlreadyExistsError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  if (INDEX_ALREADY_EXISTS.test(error.message)) {
    return true;
  }
  const cause = error.cause;
  if (cause instanceof Error && INDEX_ALREADY_EXISTS.test(cause.message)) {
    return true;
  }
  return false;
}

async function ensureIndex(
  vector: MastraVector,
  indexName: string,
  dimension: number,
): Promise<void> {
  try {
    await vector.createIndex({ indexName, dimension, metric: "cosine" });
  } catch (error) {
    if (isIndexAlreadyExistsError(error)) {
      return;
    }
    throw error;
  }
}

function batchChunks<T>(items: T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  return batches;
}

/**
 * Extract the input-token count from AI SDK v6's `embedMany` usage object.
 * The shape varies by SDK minor: some providers return `usage.tokens`, some
 * return `usage.inputTokens`, some wrap in `usage.input` with nested fields.
 * Returns 0 (and no cost) if the SDK didn't surface a number we recognise.
 */
function tokensFromUsage(usage: unknown): number {
  if (usage == null || typeof usage !== "object") return 0;
  const u = usage as Record<string, unknown>;
  if (typeof u.tokens === "number" && Number.isFinite(u.tokens)) return u.tokens;
  if (typeof u.inputTokens === "number" && Number.isFinite(u.inputTokens)) return u.inputTokens;
  if (typeof u.totalTokens === "number" && Number.isFinite(u.totalTokens)) return u.totalTokens;
  if (u.input != null && typeof u.input === "object") {
    const inner = (u.input as { total?: unknown; tokens?: unknown });
    if (typeof inner.total === "number" && Number.isFinite(inner.total)) return inner.total;
    if (typeof inner.tokens === "number" && Number.isFinite(inner.tokens)) return inner.tokens;
  }
  return 0;
}

export async function buildIndex(opts: {
  layer: SemanticLayer;
  chunker?: Chunker;
  provider: EmbeddingProvider;
  vector: MastraVector;
  indexName: string;
  batchSize?: number;
  /**
   * Forwarded to AI SDK v6 `embedMany`. Set for provider-specific options like
   * Google's MRL `{ google: { outputDimensionality: 768 } }`. retrieve() MUST
   * be called with the same providerOptions or the query embedding shape will
   * not match the stored index (KI-livedemo-1).
   */
  providerOptions?: Record<string, Record<string, unknown>>;
}): Promise<BuildIndexResult> {
  const chunker = opts.chunker ?? ParagraphChunker;
  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;

  // [S2-fix codex-M3] Validate positive-integer inputs at entry so misuse
  // fails fast with a clear error instead of looping forever (batchSize ≤ 0)
  // or breaking opaquely inside the vector backend (dimensions ≤ 0).
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error(`buildIndex: batchSize must be a positive integer, got ${String(batchSize)}`);
  }
  if (!Number.isInteger(opts.provider.dimensions) || opts.provider.dimensions <= 0) {
    throw new Error(
      `buildIndex: provider.dimensions must be a positive integer, got ${String(opts.provider.dimensions)}`,
    );
  }

  const chunks = [...opts.layer.entities.values()].flatMap((entity) =>
    chunker.chunk(entity),
  );

  await ensureIndex(opts.vector, opts.indexName, opts.provider.dimensions);

  let totalTokens = 0;

  // providerOptions order: per-call opts.providerOptions wins over the
  // provider's own providerOptions (for one-off overrides).
  const providerOptions = opts.providerOptions ?? opts.provider.providerOptions;

  type EmbedManyArgs = Parameters<typeof embedMany>[0];
  type AiProviderOpts = NonNullable<EmbedManyArgs["providerOptions"]>;
  for (const batch of batchChunks(chunks, batchSize)) {
    // AI SDK v6 types `providerOptions` as `SharedV3ProviderOptions` (a typed
    // union); our public shape Record<string, Record<string, unknown>> is
    // structurally identical at runtime. Cast at the call boundary so consumers
    // don't need to import AI SDK internals.
    const args: EmbedManyArgs = {
      model: opts.provider.model,
      values: batch.map((chunk) => chunk.text),
    };
    if (providerOptions !== undefined) {
      args.providerOptions = providerOptions as AiProviderOpts;
    }
    const result = await embedMany(args);

    totalTokens += tokensFromUsage(result.usage);

    await opts.vector.upsert({
      indexName: opts.indexName,
      vectors: result.embeddings,
      // [S2-fix pi-M1] Store chunk text alongside its metadata so retrieve()
      // can round-trip the original text without a second lookup. Required by
      // explore-rag.ts's __full__ chunk consumers and direct retrieve() users.
      metadata: batch.map((chunk) => ({ ...chunk.metadata, text: chunk.text })),
      ids: batch.map((chunk) => chunk.id),
    });
  }

  return {
    chunkCount: chunks.length,
    totalEmbeddingCost:
      (totalTokens * opts.provider.costPerMillionTokens) / 1_000_000,
  };
}
