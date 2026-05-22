/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Bootstrap the starter's database:
 *   1. Create the read-only `arivie_reader` Postgres role + grants.
 *   2. Write the owner identity row Arivie uses for tenant scoping.
 *   3. Apply the e-commerce schema bundled at seed/001_schema.sql.
 *   4. Seed the synthetic e-commerce data at seed/002_seed.sql.
 *
 * Idempotent — re-running drops + reloads the seed via the TRUNCATE in
 * 002_seed.sql but leaves the role + owner identity in place.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { postgresAdapter } from "@arivie/db-postgres";
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const ownerId = process.env.ARIVIE_OWNER_ID ?? "arivie-chat";
  const dir = join(import.meta.dirname, "..", "seed");

  // 1. Role + grants via Arivie's postgresAdapter helper.
  const db = postgresAdapter({ url, readOnlyRole: "arivie_reader" });
  await db.setupRole("arivie_reader");

  // 2. Owner identity row.
  const sql = postgres(url);
  await sql.unsafe(
    "INSERT INTO arivie_owner_identity (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    ["owner_id", ownerId],
  );

  // 3 + 4. Apply schema then seed. `postgres` rejects BEGIN/COMMIT inside
  // `sql.unsafe()` — we open an explicit transaction via `sql.begin()`.
  const schema = readFileSync(join(dir, "001_schema.sql"), "utf8");
  const seed = readFileSync(join(dir, "002_seed.sql"), "utf8");
  await sql.unsafe(schema);
  await sql.begin(async (tx) => {
    // Strip any BEGIN/COMMIT lines from the seed file — we own the tx here.
    const seedSql = seed
      .replace(/^\s*BEGIN\s*;?\s*$/gim, "")
      .replace(/^\s*COMMIT\s*;?\s*$/gim, "");
    await tx.unsafe(seedSql);
  });

  await sql.end();
  await db.sql.end();
  console.log(
    `ok: role arivie_reader ready, owner_id=${ownerId}, ` +
      "e-commerce schema + 80 orders / 198 items / 30 customers / 20 products seeded.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
