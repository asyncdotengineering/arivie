/* SPDX-License-Identifier: Apache-2.0 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PostgresAdapter } from "@arivie/db-postgres";
import { pglitePostgresAdapter } from "../../../scripts/pglite-adapter.js";

const exampleRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Start an in-process PGlite database seeded from db/seed.sql and return the
 * adapter directly. The smoke injects this adapter into `createArivie({ source })`
 * (mirroring scripts/run-eval.ts) — no socket connection, no live Postgres.
 */
export async function bootstrapEyewearPglite(): Promise<{
  adapter: PostgresAdapter;
  cleanup: () => Promise<void>;
}> {
  const adapter = await pglitePostgresAdapter();
  const seedSql = readFileSync(join(exampleRoot, "db/seed.sql"), "utf8");

  await adapter.setupRole("arivie_reader");
  await adapter.sql.unsafe(seedSql);
  await adapter.sql.unsafe(
    `GRANT SELECT ON TABLE customers, orders, order_items, refunds, remakes TO arivie_reader`,
  );

  return {
    adapter,
    cleanup: async () => {
      await adapter.close?.();
    },
  };
}
