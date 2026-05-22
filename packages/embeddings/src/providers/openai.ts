/* SPDX-License-Identifier: Apache-2.0 */
import { createOpenAI } from "@ai-sdk/openai";
import type { EmbeddingProvider } from "../types.js";

export type OpenAIEmbeddingModelId =
  | "text-embedding-3-small"
  | "text-embedding-3-large";

const OPENAI_MODEL_META: Record<
  OpenAIEmbeddingModelId,
  { dimensions: number; costPerMillionTokens: number }
> = {
  "text-embedding-3-small": { dimensions: 1536, costPerMillionTokens: 0.02 },
  "text-embedding-3-large": { dimensions: 3072, costPerMillionTokens: 0.13 },
};

/** OpenAI public pricing snapshot 2026-05-20; pass `costPerMillionTokens` to override. */
export function openAIEmbeddings(opts: {
  apiKey: string;
  model?: OpenAIEmbeddingModelId;
  costPerMillionTokens?: number;
}): EmbeddingProvider {
  const modelName = opts.model ?? "text-embedding-3-small";
  const meta = OPENAI_MODEL_META[modelName];
  const provider = createOpenAI({ apiKey: opts.apiKey });

  return {
    model: provider.embedding(modelName),
    modelName,
    dimensions: meta.dimensions,
    costPerMillionTokens: opts.costPerMillionTokens ?? meta.costPerMillionTokens,
  };
}
