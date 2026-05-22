/* SPDX-License-Identifier: Apache-2.0 */
import { createVoyage } from "@ai-sdk/voyage";
import type { EmbeddingProvider } from "../types.js";

const DEFAULT_MODEL = "voyage-3";
const DEFAULT_DIMENSIONS = 1024;
/** Voyage public pricing snapshot 2026-05-20; pass `costPerMillionTokens` to override. */
const DEFAULT_COST_PER_MILLION_TOKENS = 0.06;

export function voyageEmbeddings(opts: {
  apiKey: string;
  model?: string;
  dimensions?: number;
  costPerMillionTokens?: number;
}): EmbeddingProvider {
  const modelName = opts.model ?? DEFAULT_MODEL;
  const provider = createVoyage({ apiKey: opts.apiKey });

  return {
    model: provider.embedding(modelName),
    modelName,
    dimensions: opts.dimensions ?? DEFAULT_DIMENSIONS,
    costPerMillionTokens:
      opts.costPerMillionTokens ?? DEFAULT_COST_PER_MILLION_TOKENS,
  };
}
