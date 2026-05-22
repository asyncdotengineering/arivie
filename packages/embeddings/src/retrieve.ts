/* SPDX-License-Identifier: Apache-2.0 */
import type { MastraVector } from "@mastra/core/vector";
import type { QueryResult } from "@mastra/core/vector";
import { embed } from "ai";
import type { Chunk, EmbeddingProvider } from "./types.js";

const DEFAULT_TOP_K = 5;

function toChunk(result: QueryResult): Chunk {
  const metadata = result.metadata ?? {};
  return {
    id: result.id,
    text: typeof metadata.text === "string" ? metadata.text : "",
    metadata: metadata as Chunk["metadata"],
  };
}

/**
 * Embed `opts.query` via `opts.provider.model` and look it up in
 * `opts.vector` under `opts.indexName`.
 *
 * `providerOptions` is forwarded to AI SDK v6's `embed()` — required when the
 * stored index was built with provider-specific options that change the
 * embedding shape, e.g. Google's Matryoshka Representation Learning:
 * `{ google: { outputDimensionality: 768 } }`. Without this, query embeddings
 * come back at the model's native dimensionality (e.g. 3072 for
 * gemini-embedding-001) and the vector lookup fails with a dimension mismatch
 * vs the stored index. Surfaced as KI-livedemo-1.
 */
export async function retrieve(opts: {
  query: string;
  vector: MastraVector;
  indexName: string;
  provider: EmbeddingProvider;
  topK?: number;
  entityHint?: string;
  providerOptions?: Record<string, Record<string, unknown>>;
}): Promise<Chunk[]> {
  // Per-call opts.providerOptions wins over the provider's own providerOptions
  // (for one-off overrides). Both build and query symmetric.
  const providerOptions = opts.providerOptions ?? opts.provider.providerOptions;

  type EmbedArgs = Parameters<typeof embed>[0];
  type AiProviderOpts = NonNullable<EmbedArgs["providerOptions"]>;
  const args: EmbedArgs = {
    model: opts.provider.model,
    value: opts.query,
  };
  if (providerOptions !== undefined) {
    args.providerOptions = providerOptions as AiProviderOpts;
  }
  const { embedding } = await embed(args);

  const filter = opts.entityHint ? { entity: opts.entityHint } : undefined;

  const results = await opts.vector.query({
    indexName: opts.indexName,
    queryVector: embedding,
    topK: opts.topK ?? DEFAULT_TOP_K,
    filter,
  });

  return [...results]
    .sort((a, b) => b.score - a.score)
    .map(toChunk);
}
