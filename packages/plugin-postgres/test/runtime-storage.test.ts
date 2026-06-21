/* SPDX-License-Identifier: Apache-2.0 */
import { execSync } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertStorageContract } from "@arivie/core";
import type { RuntimeStorage } from "@arivie/core";
import {
  migrateRuntimeStorage,
  RUNTIME_STORAGE_TABLES,
} from "../src/migrations.js";
import { postgresRuntime } from "../src/index.js";

function dockerAvailable(): boolean {
  try {
    execSync("docker info", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function truncateRuntimeStorage(url: string): Promise<void> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrateRuntimeStorage(sql);
    await sql.unsafe(`TRUNCATE ${RUNTIME_STORAGE_TABLES.join(", ")} RESTART IDENTITY CASCADE`);
  } finally {
    await sql.end();
  }
}

describe("@arivie/plugin-postgres runtime storage", () => {
  let pg: PGlite;
  let server: PGLiteSocketServer;
  let url: string;
  let activeStore: RuntimeStorage | undefined;

  beforeAll(async () => {
    pg = new PGlite();
    server = new PGLiteSocketServer({
      db: pg,
      port: 0,
      host: "127.0.0.1",
    });
    await server.start();
    url = `postgres://${server.getServerConn()}/postgres`;
    await truncateRuntimeStorage(url);
  });

  afterAll(async () => {
    await activeStore?.close?.();
    await server.stop();
    await pg.close();
  });

  it("passes the shared RuntimeStorage contract against PGlite over TCP", async () => {
    await assertStorageContract(async () => {
      await activeStore?.close?.();
      await truncateRuntimeStorage(url);
      activeStore = postgresRuntime({ url, maxConnections: 1 });
      return activeStore;
    });
  }, 30_000);
});

const describeDocker = describe.skipIf(!dockerAvailable());

describeDocker("@arivie/plugin-postgres dispatch concurrency", () => {
  let container: Awaited<ReturnType<PostgreSqlContainer["start"]>>;
  let url: string;
  const stores: RuntimeStorage[] = [];

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16-alpine").start();
    url = container.getConnectionUri();
    await truncateRuntimeStorage(url);
  }, 120_000);

  afterAll(async () => {
    await Promise.all(stores.map((store) => store.close?.()));
    await container.stop();
  });

  it("does not double-claim one ready message across separate connections", async () => {
    const admitting = postgresRuntime({ url, maxConnections: 1 });
    stores.push(admitting);
    const admitted = await admitting.dispatch.admit({
      channel: "gh",
      event: { delivery: "one" },
      dedupeKey: "delivery-1",
      now: 1_000,
    });
    expect(admitted.duplicate).toBe(false);

    const workers = Array.from({ length: 8 }, (_, index) => {
      const store = postgresRuntime({ url, maxConnections: 1 });
      stores.push(store);
      return store.dispatch.claimReady({
        limit: 1,
        leaseMs: 60_000,
        workerId: `worker-${index}`,
        now: 1_000,
      });
    });

    const claimed = await Promise.all(workers);
    expect(claimed.flat()).toHaveLength(1);
  });
});
