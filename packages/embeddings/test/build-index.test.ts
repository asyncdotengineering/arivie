/* SPDX-License-Identifier: Apache-2.0 */
import { execSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSemanticLayerSync } from "@arivie/semantic";
import { PgVector } from "@mastra/pg";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildIndex } from "../src/build-index.js";
import type { MastraVector } from "@mastra/core/vector";
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

describeIntegration.sequential("buildIndex integration", () => {
  let container: Awaited<ReturnType<PostgreSqlContainer["start"]>>;
  let pgVector: PgVector;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("pgvector/pgvector:pg16").start();
    pgVector = new PgVector({
      id: "embeddings-test",
      connectionString: container.getConnectionUri(),
    });
  }, 120_000);

  afterAll(async () => {
    await pgVector.disconnect();
    await container.stop();
  });

  it("indexes a semantic layer and returns cost rollup", async () => {
    const layer = loadSemanticLayerSync(fixturesDir);
    const provider = mockEmbeddingProvider({
      dimensions: 8,
      costPerMillionTokens: 0.01,
    });

    const result = await buildIndex({
      layer,
      provider,
      vector: pgVector,
      indexName: "test_idx",
      batchSize: 96,
    });

    expect(result.chunkCount).toBeGreaterThan(0);
    expect(result.totalEmbeddingCost).toBeGreaterThan(0);
  });

  it("writes rows queryable via pgvector", async () => {
    const queryVector = new Array<number>(8).fill(0);
    const hits = await pgVector.query({
      indexName: "test_idx",
      queryVector,
      topK: 5,
    });
    expect(hits).toHaveLength(5);
    expect(hits[0]?.id).toBeTruthy();
    expect(hits[0]?.metadata?.entity).toBeTruthy();
  });

  it("rethrows when vector upsert fails", async () => {
    const layer = loadSemanticLayerSync(fixturesDir);
    const provider = mockEmbeddingProvider({
      dimensions: 8,
      costPerMillionTokens: 0.01,
    });

    const failingVector: MastraVector = {
      id: "failing",
      createIndex: vi.fn().mockResolvedValue(undefined),
      upsert: vi.fn().mockRejectedValue(new Error("upsert failed")),
    } as unknown as MastraVector;

    await expect(
      buildIndex({
        layer,
        provider,
        vector: failingVector,
        indexName: "fail_idx",
      }),
    ).rejects.toThrow("upsert failed");
  });
});
