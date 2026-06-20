/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Eval database adapter selection.
 *
 * Defaults to an in-process PGlite instance so `pnpm eval` works without
 * Docker. Set `USE_TESTCONTAINERS=1` to use the original testcontainers
 * Postgres path.
 */
import { execSync } from "node:child_process";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { postgresAdapter } from "@arivie/db-postgres";
import type { PostgresAdapter } from "@arivie/db-postgres";
import { pglitePostgresAdapter } from "./pglite-adapter.js";

export interface EvalAdapters {
  db: PostgresAdapter;
  readerDb: PostgresAdapter;
  cleanup: () => Promise<void>;
}

function dockerAvailable(): boolean {
  try {
    execSync("docker info", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function readerConnectionUrl(superuserUrl: string): string {
  const url = new URL(superuserUrl);
  url.username = "arivie_reader";
  url.password = "test-arivie-reader";
  return url.toString();
}

async function createTestcontainersAdapters(): Promise<EvalAdapters> {
  const container = await new PostgreSqlContainer("postgres:16-alpine").start();
  const connectionUrl = container.getConnectionUri();
  const readerUrl = readerConnectionUrl(connectionUrl);

  const db = postgresAdapter({ url: connectionUrl });
  const readerDb = postgresAdapter({ url: readerUrl });

  return {
    db,
    readerDb,
    cleanup: async () => {
      await db.sql.end();
      await readerDb.sql.end();
      await container.stop();
    },
  };
}
async function createPgliteAdapters(): Promise<EvalAdapters> {
  const db = await pglitePostgresAdapter();

  return {
    db,
    readerDb: db,
    cleanup: async () => {
      await db.close?.();
    },
  };
}

export async function createEvalAdapters(): Promise<EvalAdapters> {
  if (process.env.USE_TESTCONTAINERS === "1") {
    if (!dockerAvailable()) {
      throw new Error(
        "USE_TESTCONTAINERS=1 requested but Docker is not available.",
      );
    }
    return createTestcontainersAdapters();
  }
  return createPgliteAdapters();
}
