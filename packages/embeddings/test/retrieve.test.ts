/* SPDX-License-Identifier: Apache-2.0 */
import { execSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSemanticLayerSync } from "@arivie/semantic";
import type { MastraVector } from "@mastra/core/vector";
import type { QueryResult } from "@mastra/core/vector";
import { PgVector } from "@mastra/pg";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { embed } from "ai";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildIndex } from "../src/build-index.js";
import { ParagraphChunker } from "../src/chunker.js";
import { retrieve } from "../src/retrieve.js";
import type { Chunk } from "../src/types.js";
import { mockEmbeddingProvider } from "./_mock-provider.js";

function dockerAvailable(): boolean {
  try {
    execSync("docker info", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const describeIntegration = describe.skipIf(!dockerAvailable());

const fixturesDir = join(
  fileURLToPath(new URL("../../agent/test/fixtures", import.meta.url)),
  "sem-5",
);

function isValidChunk(chunk: Chunk): boolean {
  return (
    typeof chunk.id === "string" &&
    chunk.id.length > 0 &&
    typeof chunk.text === "string" &&
    typeof chunk.metadata.entity === "string" &&
    chunk.metadata.entity.length > 0 &&
    typeof chunk.metadata.paragraph_idx === "number" &&
    typeof chunk.metadata.section === "string"
  );
}

describe("retrieve (unit)", () => {
  it("embeds the query, queries the vector store, and maps results", async () => {
    const provider = mockEmbeddingProvider({
      dimensions: 8,
      costPerMillionTokens: 0.01,
    });
    const { embedding: expectedVector } = await embed({
      model: provider.model,
      value: "x",
    });

    const mockResults: QueryResult[] = [
      {
        id: "orders/measure/0",
        score: 0.9,
        metadata: {
          entity: "orders",
          paragraph_idx: 0,
          section: "measure",
          name: "revenue",
          text: "Total order revenue",
        },
      },
      {
        id: "invoices/measure/1",
        score: 0.7,
        metadata: {
          entity: "invoices",
          paragraph_idx: 1,
          section: "measure",
          text: "Invoice amount",
        },
      },
      {
        id: "customers/description/0",
        score: 0.5,
        metadata: {
          entity: "customers",
          paragraph_idx: 0,
          section: "description",
          text: "Customer records",
        },
      },
    ];

    const query = vi.fn().mockResolvedValue(mockResults);
    const mockVector = { id: "mock", query } as unknown as MastraVector;

    const chunks = await retrieve({
      query: "x",
      vector: mockVector,
      indexName: "i",
      provider,
      topK: 3,
    });

    expect(chunks).toHaveLength(3);
    expect(query).toHaveBeenCalledWith({
      indexName: "i",
      queryVector: expectedVector,
      topK: 3,
      filter: undefined,
    });
    expect(chunks[0]?.id).toBe("orders/measure/0");
    expect(chunks[0]?.text).toBe("Total order revenue");
    expect(chunks[1]?.id).toBe("invoices/measure/1");
    expect(chunks[2]?.id).toBe("customers/description/0");
  });

  it("sorts results by descending score", async () => {
    const provider = mockEmbeddingProvider({
      dimensions: 4,
      costPerMillionTokens: 0,
    });

    const mockResults: QueryResult[] = [
      {
        id: "low",
        score: 0.1,
        metadata: { entity: "a", paragraph_idx: 0, section: "description" },
      },
      {
        id: "high",
        score: 0.99,
        metadata: { entity: "b", paragraph_idx: 0, section: "description" },
      },
      {
        id: "mid",
        score: 0.5,
        metadata: { entity: "c", paragraph_idx: 0, section: "description" },
      },
    ];

    const query = vi.fn().mockResolvedValue(mockResults);
    const mockVector = { id: "mock", query } as unknown as MastraVector;

    const chunks = await retrieve({
      query: "q",
      vector: mockVector,
      indexName: "idx",
      provider,
      topK: 3,
    });

    expect(chunks.map((c) => c.id)).toEqual(["high", "mid", "low"]);
  });

  it("passes entityHint as a metadata filter", async () => {
    const provider = mockEmbeddingProvider({
      dimensions: 4,
      costPerMillionTokens: 0,
    });
    const query = vi.fn().mockResolvedValue([]);
    const mockVector = { id: "mock", query } as unknown as MastraVector;

    await retrieve({
      query: "revenue",
      vector: mockVector,
      indexName: "sem",
      provider,
      entityHint: "orders",
    });

    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({ filter: { entity: "orders" } }),
    );
  });

  it("defaults topK to 5", async () => {
    const provider = mockEmbeddingProvider({
      dimensions: 4,
      costPerMillionTokens: 0,
    });
    const query = vi.fn().mockResolvedValue([]);
    const mockVector = { id: "mock", query } as unknown as MastraVector;

    await retrieve({
      query: "q",
      vector: mockVector,
      indexName: "idx",
      provider,
    });

    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({ topK: 5 }),
    );
  });
});

describeIntegration.sequential("retrieve integration", () => {
  let container: Awaited<ReturnType<PostgreSqlContainer["start"]>>;
  let pgVector: PgVector;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("pgvector/pgvector:pg16").start();
    pgVector = new PgVector({
      id: "retrieve-test",
      connectionString: container.getConnectionUri(),
    });

    const layer = loadSemanticLayerSync(fixturesDir);
    const provider = mockEmbeddingProvider({
      dimensions: 8,
      costPerMillionTokens: 0.01,
    });

    await buildIndex({
      layer,
      provider,
      vector: pgVector,
      indexName: "retrieve_idx",
      batchSize: 96,
    });
  }, 120_000);

  afterAll(async () => {
    await pgVector.disconnect();
    await container.stop();
  });

  it("returns topK chunks in valid Chunk shape", async () => {
    const provider = mockEmbeddingProvider({
      dimensions: 8,
      costPerMillionTokens: 0.01,
    });

    const chunks = await retrieve({
      query: "revenue",
      vector: pgVector,
      indexName: "retrieve_idx",
      provider,
      topK: 3,
    });

    expect(chunks).toHaveLength(3);
    for (const chunk of chunks) {
      expect(isValidChunk(chunk)).toBe(true);
    }
  });

  it("round-trips chunk text after buildIndex + retrieve (C16→C17)", async () => {
    const layer = loadSemanticLayerSync(fixturesDir);
    const sourceTexts = new Set(
      [...layer.entities.values()].flatMap((entity) =>
        ParagraphChunker.chunk(entity).map((chunk) => chunk.text),
      ),
    );

    const provider = mockEmbeddingProvider({
      dimensions: 8,
      costPerMillionTokens: 0.01,
    });

    const chunks = await retrieve({
      query: "revenue",
      vector: pgVector,
      indexName: "retrieve_idx",
      provider,
      topK: 5,
    });

    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeGreaterThan(0);
    }
    const matched = chunks.some((chunk) => sourceTexts.has(chunk.text));
    expect(matched).toBe(true);
  });

  it("filters by entityHint", async () => {
    const provider = mockEmbeddingProvider({
      dimensions: 8,
      costPerMillionTokens: 0.01,
    });

    const chunks = await retrieve({
      query: "x",
      vector: pgVector,
      indexName: "retrieve_idx",
      provider,
      topK: 5,
      entityHint: "orders",
    });

    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.metadata.entity).toBe("orders");
    }
  });
});
