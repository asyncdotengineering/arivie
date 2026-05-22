/* SPDX-License-Identifier: Apache-2.0 */
import { postgresAdapter } from "@arivie/db-postgres";
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const ownerId = process.env.ARIVIE_OWNER_ID ?? "arivie-chat";
  const db = postgresAdapter({ url, readOnlyRole: "arivie_reader" });
  await db.setupRole("arivie_reader");
  const sql = postgres(url);
  await sql.unsafe(
    "INSERT INTO arivie_owner_identity (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    ["owner_id", ownerId],
  );
  await sql.end();
  await db.sql.end();
  console.log(`ok: role arivie_reader ready, owner_id=${ownerId}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
