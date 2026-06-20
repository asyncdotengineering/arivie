/* SPDX-License-Identifier: Apache-2.0 */
/**
 * PGlite-backed PostgresAdapter for the dogfood eval harness.
 *
 * PGlite is a WASM build of Postgres that runs in-process with no Docker
 * required. A PGLiteSocketServer exposes the in-memory database over a local
 * TCP port so Mastra's PostgresStore can connect through the standard
 * node-postgres driver.
 */
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import type { PostgresAdapter } from "@arivie/db-postgres";
import type postgres from "postgres";

export interface PGlitePostgresAdapterOptions {
  /** Existing PGlite instance to share across adapters. */
  pg?: PGlite;
}

function createSqlProxy(pg: PGlite) {
  const sqlFn = async (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown[]> => {
    const result = await pg.sql(strings, ...values);
    return result.rows;
  };

  return Object.assign(sqlFn, {
    unsafe: async (query: string): Promise<void> => {
      await pg.exec(query);
    },
    end: async (): Promise<void> => {
      await pg.close();
    },
  });
}

export async function pglitePostgresAdapter(
  opts?: PGlitePostgresAdapterOptions,
): Promise<PostgresAdapter> {
  const pg = opts?.pg ?? new PGlite();
  const server = new PGLiteSocketServer({
    db: pg,
    port: 0,
    host: "127.0.0.1",
  });
  await server.start();

  const url = `postgres://${server.getServerConn()}/postgres`;

  return {
    kind: "postgres",
    id: "pglite:in-memory",
    url,
    sql: createSqlProxy(pg) as unknown as postgres.Sql,
    execute: async (executeOpts) => {
      const started = Date.now();
      const result = await pg.query(executeOpts.query, executeOpts.params);
      return {
        rows: result.rows as Record<string, unknown>[],
        rowCount: result.rows.length,
        durationMs: Date.now() - started,
        truncated: false,
      };
    },
    introspect: async () => [],
    verifyOwnerIdentity: async () => {},
    setupRole: async (role) => {
      try {
        await pg.query(
          `CREATE ROLE ${role} WITH LOGIN PASSWORD 'test-arivie-reader'`,
        );
      } catch (err) {
        if (!(err instanceof Error && /already exists/i.test(err.message))) {
          throw err;
        }
      }
      await pg.query(`
        CREATE TABLE IF NOT EXISTS arivie_owner_identity (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `);
    },
    compileMetric: () => {
      throw new Error("compileMetric not implemented for PGlite adapter");
    },
    close: async () => {
      await server.stop();
      await pg.close();
    },
  };
}
