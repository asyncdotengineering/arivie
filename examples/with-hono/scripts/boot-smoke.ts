/* SPDX-License-Identifier: Apache-2.0 */
import { type ChildProcess, execSync, spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { postgresAdapter } from "@arivie/db-postgres";

const MOCK_SUBSTRING = "Example mock response";
const PORT = Number(process.env.ARIVIE_SMOKE_PORT ?? 3101);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ENDPOINT = "/api/arivie";

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

async function waitForReady(timeoutMs = 45_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/`, { signal: AbortSignal.timeout(2_000) });
      if (res.ok) {
        return;
      }
    } catch {
      // server not up yet
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Server not ready at ${BASE_URL}`);
}

async function assertMockAnswer(extraHeaders?: Record<string, string>): Promise<void> {
  const res = await fetch(`${BASE_URL}${ENDPOINT}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...extraHeaders,
    },
    body: JSON.stringify({ prompt: "How many customers?" }),
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`POST ${ENDPOINT} failed: ${res.status}\n${body}`);
  }
  let text = body;
  try {
    const json = JSON.parse(body) as { answer?: string };
    if (typeof json.answer === "string") {
      text = json.answer;
    }
  } catch {
    // non-JSON body — search raw text (e.g. SSE)
  }
  if (!text.includes(MOCK_SUBSTRING)) {
    throw new Error(
      `Response missing mock substring.\n--- body (first 800 chars) ---\n${text.slice(0, 800)}`,
    );
  }
  console.log("boot:smoke OK — mock response verified");
}

function startServer(ownerId: string): ChildProcess {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  return spawn("pnpm", ["exec", "tsx", "src/server.ts"], {
    cwd: root,
    env: { ...process.env, PORT: String(PORT), ARIVIE_OWNER_ID: ownerId },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function main(): Promise<void> {
  const ownerId = "with-hono-owner";
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
      setTimeout(resolve, 3_000);
    });
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
