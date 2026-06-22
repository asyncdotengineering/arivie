/* SPDX-License-Identifier: Apache-2.0 */
import { beforeAll, describe, expect, it } from "vitest";
import { modelRouterEmbeddings } from "../src/providers/model-router.js";

describe("modelRouterEmbeddings", () => {
  // The model router validates the provider's API key at construction
  // (fail-fast). We only assert the provider SHAPE here, so a dummy key suffices.
  beforeAll(() => {
    process.env.OPENAI_API_KEY ??= "sk-test";
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ??= "test";
  });
  it("builds an EmbeddingProvider from a provider/model id (any of Mastra's 40+ providers)", () => {
    const p = modelRouterEmbeddings("openai/text-embedding-3-small", { dimensions: 1536 });
    expect(p.modelName).toBe("openai/text-embedding-3-small");
    expect(p.dimensions).toBe(1536);
    expect(p.costPerMillionTokens).toBe(0); // default
    expect(p.model).toBeDefined(); // a ModelRouterEmbeddingModel
    expect(p.providerOptions).toBeUndefined();
  });

  it("carries cost + providerOptions (Matryoshka / input_type) through symmetrically", () => {
    const p = modelRouterEmbeddings("google/gemini-embedding-001", {
      dimensions: 768,
      costPerMillionTokens: 0.15,
      providerOptions: { google: { outputDimensionality: 768 } },
    });
    expect(p.dimensions).toBe(768);
    expect(p.costPerMillionTokens).toBe(0.15);
    expect(p.providerOptions).toEqual({ google: { outputDimensionality: 768 } });
  });
});
