/* SPDX-License-Identifier: Apache-2.0 */
import { ModelRouterEmbeddingModel } from "@mastra/core/llm";
import type { EmbeddingModel } from "ai";
import type { EmbeddingProvider } from "../types.js";

export interface ModelRouterEmbeddingsOptions {
  /**
   * Vector dimensionality of the model's output. Required — it's
   * model-specific (e.g. 1536 for text-embedding-3-small) and `buildIndex`
   * sizes the vector index by it. For Matryoshka-truncated models, pass the
   * truncated dimension and mirror it in `providerOptions`.
   */
  readonly dimensions: number;
  /** USD per 1,000,000 input tokens (cost roll-up in buildIndex). Defaults to 0. */
  readonly costPerMillionTokens?: number;
  /** Forwarded symmetrically to AI SDK `embed`/`embedMany` (e.g. Matryoshka output dim). */
  readonly providerOptions?: Record<string, Record<string, unknown>>;
}

/**
 * Build an {@link EmbeddingProvider} from Mastra's model router — one factory
 * for **any** embedding provider via a `"provider/model"` id (OpenAI, Cohere,
 * Voyage, Google, Mistral, …; 40+), instead of a hand-rolled adapter per
 * provider. Auth resolves through Mastra's gateway/registry (env keys), so no
 * `apiKey` is threaded here. Embedding plumbing is commodity — this routes it
 * to Mastra; Arivie's value is the semantic-layer-aware chunking, not provider
 * glue.
 *
 * ```ts
 * const provider = modelRouterEmbeddings("openai/text-embedding-3-small", { dimensions: 1536 });
 * ```
 */
export function modelRouterEmbeddings(
  modelId: string,
  options: ModelRouterEmbeddingsOptions,
): EmbeddingProvider {
  return {
    model: new ModelRouterEmbeddingModel(modelId) as unknown as EmbeddingModel,
    modelName: modelId,
    dimensions: options.dimensions,
    costPerMillionTokens: options.costPerMillionTokens ?? 0,
    ...(options.providerOptions !== undefined
      ? { providerOptions: options.providerOptions }
      : {}),
  };
}
