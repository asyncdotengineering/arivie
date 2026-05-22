/* SPDX-License-Identifier: Apache-2.0 */
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import postgres from "postgres";
import { postgresAdapter } from "@arivie/db-postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARIVIE_ROOT = join(__dirname, "../..");
const SEED_SQL = join(ARIVIE_ROOT, "examples/with-nextjs/seed.sql");

export const QUICKSTART_OWNER_ID = "with-nextjs-owner";
export const QUICKSTART_PORT = Number(process.env.ARIVIE_QUICKSTART_PORT ?? 3010);
export const QUICKSTART_BASE_URL = `http://127.0.0.1:${QUICKSTART_PORT}`;

export type QuickstartPostgres = {
  container: Awaited<ReturnType<PostgreSqlContainer["start"]>>;
  databaseUrl: string;
};

export function dockerAvailable(): boolean {
  try {
    execSync("docker info", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export async function startQuickstartPostgres(): Promise<QuickstartPostgres> {
  const container = await new PostgreSqlContainer("postgres:16-alpine").start();
  const databaseUrl = container.getConnectionUri();

  execSync(`psql "${databaseUrl}" -v ON_ERROR_STOP=1 -f "${SEED_SQL}"`, {
    stdio: "inherit",
  });

  const db = postgresAdapter({ url: databaseUrl, readOnlyRole: "arivie_reader" });
  const sql = postgres(databaseUrl);
  try {
    await db.setupRole("arivie_reader");
    await sql`
      INSERT INTO arivie_owner_identity (key, value)
      VALUES ('owner_id', ${QUICKSTART_OWNER_ID})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `;
  } finally {
    await db.sql.end();
    await sql.end();
  }

  return { container, databaseUrl };
}

export async function stopQuickstartPostgres(
  pg: QuickstartPostgres | undefined,
): Promise<void> {
  if (pg != null) {
    await pg.container.stop();
  }
}
