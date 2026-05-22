/* SPDX-License-Identifier: Apache-2.0 */
import { type ChildProcess, execSync, spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { postgresAdapter } from "@arivie/db-postgres";

const MOCK_SUBSTRING = "Example mock response";
const PORT = Number(process.env.ARIVIE_SMOKE_PORT ?? 3102);
const BASE_URL = `http://127.0.0.1:${PORT}`;

async function prepareDatabase(ownerId: string): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (url == null || url.length === 0) {
    throw new Error("DATABASE_URL is required for boot:smoke");
  }
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const seedPath = join(root, "seed.sql");
  execSync(`psql "${url}" -v ON_ERROR_STOP=1 -f "${seedPath}"`, {
    stdio: "inherit",
  });
  const sql = postgres(url);
  try {
    const db = postgresAdapter({ url, readOnlyRole: "arivie_reader" });
    await db.setupRole("arivie_reader");
    await sql`
      INSERT INTO arivie_owner_identity (key, value)
      VALUES ('owner_id', ${ownerId})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `;
  } finally {
    await sql.end();
  }
}

async function waitForReady(): Promise<void> {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/`, { signal: AbortSignal.timeout(2_000) });
      if (res.ok) {
        return;
      }
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Server not ready at ${BASE_URL}`);
}

async function assertMockAnswer(): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/arivie`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
          },
    body: JSON.stringify({ prompt: "How many customers?" }),
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`POST failed: ${res.status}\n${body}`);
  }
  if (!body.includes(MOCK_SUBSTRING)) {
    throw new Error(`Missing mock substring in: ${body.slice(0, 800)}`);
  }
  console.log("boot:smoke OK — mock response verified");
}

function startServer(ownerId: string): ChildProcess {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  return spawn("bun", ["run", "src/index.ts"], {
    cwd: root,
    env: { ...process.env, PORT: String(PORT), ARIVIE_OWNER_ID: ownerId },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function main(): Promise<void> {
  const ownerId = "with-bun-owner";
  await prepareDatabase(ownerId);

  const child = startServer(ownerId);
  const kill = () => {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  };
  process.on("exit", kill);
  process.on("SIGINT", () => {
    kill();
    process.exit(130);
  });

  try {
    await waitForReady();
    await assertMockAnswer();
  } finally {
    kill();
    await new Promise<void>((resolve) => {
      child.on("exit", () => resolve());
      setTimeout(resolve, 5_000);
    });
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
