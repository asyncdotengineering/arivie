/* SPDX-License-Identifier: Apache-2.0 */
import { createCohere } from "@ai-sdk/cohere";
import type { EmbeddingProvider } from "../types.js";

const DEFAULT_MODEL = "embed-english-v3.0";
const DEFAULT_DIMENSIONS = 1024;
/** Cohere public pricing snapshot 2026-05-20; pass `costPerMillionTokens` to override. */
const DEFAULT_COST_PER_MILLION_TOKENS = 0.1;

export function cohereEmbeddings(opts: {
  apiKey: string;
  model?: string;
  dimensions?: number;
  costPerMillionTokens?: number;
}): EmbeddingProvider {
  const modelName = opts.model ?? DEFAULT_MODEL;
  const provider = createCohere({ apiKey: opts.apiKey });

  return {
    model: provider.embedding(modelName),
    modelName,
    dimensions: opts.dimensions ?? DEFAULT_DIMENSIONS,
    costPerMillionTokens:
      opts.costPerMillionTokens ?? DEFAULT_COST_PER_MILLION_TOKENS,
  };
}
