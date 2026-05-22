/* SPDX-License-Identifier: Apache-2.0 */
import type { MastraVector } from "@mastra/core/vector";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ArivieConfigSchema } from "../src/config.js";
import { ArivieConfigError, defineArivie } from "../src/define.js";

function mockEmbeddings() {
  const provider = {
    model: {},
    modelName: "mock-embed",
    dimensions: 8,
    costPerMillionTokens: 0,
  };
  const vector = {
    query: async () => [],
    upsert: async () => {},
  } as unknown as MastraVector;
  return { provider, vector, indexName: "test_idx" };
}

const mockModel = { provider: "mock" };
const mockSource = {
  kind: "postgres",
  id: "postgres:mock",
  url: "postgres://localhost/arivie",
  sql: {},
  execute: async () => ({ rows: [], rowCount: 0, durationMs: 0, truncated: false }),
  introspect: async () => [],
  verifyOwnerIdentity: async () => {},
  setupRole: async () => {},
};
const resolveUser = async () => ({
  userId: "user-1",
  permissions: [] as string[],
  dbRole: "arivie_reader",
});

const validMinimalConfig = {
  owner: { id: "owner-1", name: "Acme" },
  model: mockModel,
  workspace: { rootDir: "./semantic" },
  semantic: { path: "./semantic", mode: "auto" as const },
  sources: { postgres: mockSource },
  resolveUser,
};

describe("ArivieConfigSchema", () => {
  it("accepts a minimal valid config", () => {
    const parsed = ArivieConfigSchema.parse(validMinimalConfig);
    expect(parsed.owner.id).toBe("owner-1");
    expect(parsed.semantic.path).toBe("./semantic");
    expect(parsed.semantic.mode).toBe("auto");
  });

  it("throws on empty owner.id", () => {
    expect(() =>
      ArivieConfigSchema.parse({
        ...validMinimalConfig,
        owner: { id: "", name: "X" },
      }),
    ).toThrow(z.ZodError);
  });

  it("throws when model is missing", () => {
    const { model: _model, ...withoutModel } = validMinimalConfig;
    expect(() => ArivieConfigSchema.parse(withoutModel)).toThrow();
  });

  it("rejects top-level db: (v0.2 — use sources)", () => {
    expect(() =>
      ArivieConfigSchema.parse({
        ...validMinimalConfig,
        db: mockSource,
      }),
    ).toThrow(z.ZodError);
  });

  it("throws when sources is missing", () => {
    const { sources: _sources, ...withoutSources } = validMinimalConfig;
    expect(() => ArivieConfigSchema.parse(withoutSources)).toThrow();
  });

  it("requires semantic.embeddings when mode is indexed", () => {
    expect(() =>
      ArivieConfigSchema.parse({
        ...validMinimalConfig,
        semantic: { path: "./semantic", mode: "indexed" },
      }),
    ).toThrow(z.ZodError);
  });

  it("rejects removed semantic.mode browse", () => {
    expect(() =>
      ArivieConfigSchema.parse({
        ...validMinimalConfig,
        semantic: { path: "./semantic", mode: "browse" },
      }),
    ).toThrow(z.ZodError);
  });

  it("accepts semantic.embeddings with provider, vector, and indexName for indexed mode", () => {
    const parsed = ArivieConfigSchema.parse({
      ...validMinimalConfig,
      semantic: {
        path: "./semantic",
        mode: "indexed",
        embeddings: mockEmbeddings(),
      },
    });
    expect(parsed.semantic.embeddings?.indexName).toBe("test_idx");
  });

  it("rejects embeddings without a MastraVector duck type", () => {
    expect(() =>
      ArivieConfigSchema.parse({
        ...validMinimalConfig,
        semantic: {
          path: "./semantic",
          mode: "indexed",
          embeddings: {
            provider: mockEmbeddings().provider,
            vector: { id: "bad" },
            indexName: "idx",
          },
        },
      }),
    ).toThrow(z.ZodError);
  });
});

describe("defineArivie", () => {
  it("throws ArivieConfigError for invalid config", async () => {
    await expect(
      defineArivie({
        ...validMinimalConfig,
        owner: { id: "", name: "X" },
      }),
    ).rejects.toThrow(ArivieConfigError);
  });
});
