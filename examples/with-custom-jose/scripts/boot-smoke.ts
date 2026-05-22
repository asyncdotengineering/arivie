/* SPDX-License-Identifier: Apache-2.0 */
import { type ChildProcess, execSync, spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { postgresAdapter } from "@arivie/db-postgres";
import { BYPASS_BEARER, BYPASS_OWNER_ID } from "../lib/auth-bypass";

const MOCK_SUBSTRING = "Example mock response";
const PORT = Number(process.env.ARIVIE_SMOKE_PORT ?? 3114);
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
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(BASE_URL, { signal: AbortSignal.timeout(3_000) });
      if (res.status < 500) {
        return;
      }
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  throw new Error(`Next.js not ready at ${BASE_URL}`);
}

async function assertMockAnswer(headers: Record<string, string>): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/arivie`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify({ prompt: "How many customers?" }),
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`POST failed: ${res.status}\n${body}`);
  }
  if (!body.includes(MOCK_SUBSTRING)) {
    throw new Error(`Missing mock substring: ${body.slice(0, 800)}`);
  }
  console.log("boot:smoke OK — mock response verified");
}

function startNext(): ChildProcess {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  return spawn("pnpm", ["exec", "next", "dev", "-p", String(PORT)], {
    cwd: root,
    env: {
      ...process.env,
      ARIVIE_AUTH_BYPASS: "1",
      ARIVIE_OWNER_ID: BYPASS_OWNER_ID,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function main(): Promise<void> {
  const ownerId = BYPASS_OWNER_ID;
  await prepareDatabase(ownerId);

  const child = startNext();
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
    await assertMockAnswer({ Authorization: `Bearer ${BYPASS_BEARER}` });
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
