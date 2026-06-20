/* SPDX-License-Identifier: Apache-2.0 */
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { exampleRoot, loadEnv } from "./env.js";

loadEnv();

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://localhost:5432/arivie_woocommerce_orders";
const databaseName = new URL(databaseUrl).pathname.replace(/^\//, "") || "arivie_woocommerce_orders";

function run(command: string, args: string[]): string {
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

const exists = run("psql", [
  "-d",
  "postgres",
  "-tAc",
  `SELECT 1 FROM pg_database WHERE datname = '${databaseName.replace(/'/g, "''")}'`,
]).trim();

if (exists !== "1") {
  run("createdb", [databaseName]);
  console.log(`[woocommerce] created database ${databaseName}`);
}

run("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1", "-f", join(exampleRoot, "db", "schema.sql")]);
console.log(`[woocommerce] schema applied to ${databaseName}`);
