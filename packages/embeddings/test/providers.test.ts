/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import {
  cohereEmbeddings,
  openAIEmbeddings,
  voyageEmbeddings,
} from "../src/index.js";

const PROVIDER_DEFAULTS = [
  {
    provider: "openai",
    model: "text-embedding-3-small",
    dimensions: 1536,
    costPerMillionTokens: 0.02,
  },
  {
    provider: "openai",
    model: "text-embedding-3-large",
    dimensions: 3072,
    costPerMillionTokens: 0.13,
  },
  {
    provider: "cohere",
    model: "embed-english-v3.0",
    dimensions: 1024,
    costPerMillionTokens: 0.1,
  },
  {
    provider: "voyage",
    model: "voyage-3",
    dimensions: 1024,
    costPerMillionTokens: 0.06,
  },
] as const;

function factoryFor(
  row: (typeof PROVIDER_DEFAULTS)[number],
  apiKey = "sk-fake",
) {
  switch (row.provider) {
    case "openai":
      return openAIEmbeddings({
        apiKey,
        model: row.model as "text-embedding-3-small" | "text-embedding-3-large",
      });
    case "cohere":
      return cohereEmbeddings({ apiKey });
    case "voyage":
      return voyageEmbeddings({ apiKey });
  }
}

describe("embedding provider factories", () => {
  it("constructs OpenAI provider without throwing", () => {
    expect(() =>
      openAIEmbeddings({ apiKey: "sk-fake" }),
    ).not.toThrow();
  });

  it("constructs Cohere provider without throwing", () => {
    expect(() => cohereEmbeddings({ apiKey: "sk-fake" })).not.toThrow();
  });

  it("constructs Voyage provider without throwing", () => {
    expect(() => voyageEmbeddings({ apiKey: "sk-fake" })).not.toThrow();
  });

  it.each(PROVIDER_DEFAULTS)(
    "$provider default ($model) exposes documented metadata and AI SDK model",
    (row) => {
      const provider = factoryFor(row);
      expect(provider.modelName).toBe(row.model);
      expect(provider.dimensions).toBe(row.dimensions);
      expect(provider.costPerMillionTokens).toBe(row.costPerMillionTokens);
      expect(provider.model).toBeTruthy();
      expect(provider.model).toMatchObject({
        specificationVersion: "v3",
      });
    },
  );

  it("honors costPerMillionTokens override on OpenAI", () => {
    const provider = openAIEmbeddings({
      apiKey: "x",
      costPerMillionTokens: 0.05,
    });
    expect(provider.costPerMillionTokens).toBe(0.05);
  });

  it("OpenAI large model uses 3072 dimensions and $0.13/M tokens", () => {
    const provider = openAIEmbeddings({
      apiKey: "sk-fake",
      model: "text-embedding-3-large",
    });
    expect(provider.modelName).toBe("text-embedding-3-large");
    expect(provider.dimensions).toBe(3072);
    expect(provider.costPerMillionTokens).toBe(0.13);
  });

  it("Cohere unknown model id still constructs; dimensions default to 1024", () => {
    const provider = cohereEmbeddings({
      apiKey: "sk-fake",
      model: "embed-unknown-v9.9",
    });
    expect(provider.modelName).toBe("embed-unknown-v9.9");
    expect(provider.dimensions).toBe(1024);
    expect(provider.model).toMatchObject({ specificationVersion: "v3" });
  });

  it("Cohere honors dimensions override", () => {
    const provider = cohereEmbeddings({
      apiKey: "sk-fake",
      dimensions: 512,
    });
    expect(provider.dimensions).toBe(512);
  });

  it("Voyage unknown model id still constructs; dimensions default to 1024", () => {
    const provider = voyageEmbeddings({
      apiKey: "sk-fake",
      model: "voyage-unknown",
    });
    expect(provider.modelName).toBe("voyage-unknown");
    expect(provider.dimensions).toBe(1024);
    expect(provider.model).toMatchObject({ specificationVersion: "v3" });
  });

  it("Voyage honors costPerMillionTokens override", () => {
    const provider = voyageEmbeddings({
      apiKey: "sk-fake",
      costPerMillionTokens: 0.12,
    });
    expect(provider.costPerMillionTokens).toBe(0.12);
  });

  it("matches the documented provider defaults table", () => {
    expect(PROVIDER_DEFAULTS).toMatchInlineSnapshot(`
      [
        {
          "costPerMillionTokens": 0.02,
          "dimensions": 1536,
          "model": "text-embedding-3-small",
          "provider": "openai",
        },
        {
          "costPerMillionTokens": 0.13,
          "dimensions": 3072,
          "model": "text-embedding-3-large",
          "provider": "openai",
        },
        {
          "costPerMillionTokens": 0.1,
          "dimensions": 1024,
          "model": "embed-english-v3.0",
          "provider": "cohere",
        },
        {
          "costPerMillionTokens": 0.06,
          "dimensions": 1024,
          "model": "voyage-3",
          "provider": "voyage",
        },
      ]
    `);
  });
});
