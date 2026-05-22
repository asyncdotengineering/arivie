/* SPDX-License-Identifier: Apache-2.0 */
import { MockEmbeddingModelV3 } from "ai/test";
import type { EmbeddingProvider } from "@arivie/embeddings";

export function mockEmbeddingProvider(opts: {
  dimensions: number;
  costPerMillionTokens: number;
  modelName?: string;
}): EmbeddingProvider {
  const { dimensions, costPerMillionTokens, modelName = "mock-embed" } = opts;

  const model = new MockEmbeddingModelV3({
    provider: "mock",
    modelId: modelName,
    maxEmbeddingsPerCall: 512,
    supportsParallelCalls: true,
    doEmbed: async ({ values }) => ({
      embeddings: values.map((text) => {
        const vector = new Array<number>(dimensions).fill(0);
        for (let i = 0; i < dimensions; i += 1) {
          vector[i] = ((text.length + i) % dimensions) / dimensions;
        }
        return vector;
      }),
      usage: {
        tokens: values.reduce((sum, text) => sum + text.length, 0),
      },
      warnings: [],
    }),
  });

  return {
    model,
    modelName,
    dimensions,
    costPerMillionTokens,
  };
}
