/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Minimal Node CLI that fires a real LLM round-trip through the Arivie agent
 * against the seeded `arivie` Postgres DB. Bypasses the Next.js handler so we
 * can isolate the agent + tool + DB path. Reads .env.local from the with-nextjs
 * example so we share its DB URL and API key.
 *
 * Usage:
 *   cd arivie
 *   tsx scripts/ask-live.ts "How many orders do we have?"
 */
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { defineArivie } from "@arivie/core";
import { runWithUserContext } from "@arivie/core/context";
import { postgresAdapter } from "@arivie/db-postgres";
import { InProcessSandboxFilesystem } from "@arivie/workspace";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "..", ".env.local");

function loadEnv(): void {
  try {
    const raw = readFileSync(envPath, "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (trimmed === "" || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (process.env[key] == null && value !== "") {
        process.env[key] = value;
      }
    }
  } catch (err) {
    console.warn(`[ask-live] could not read ${envPath}: ${String(err)}`);
  }
}

async function main(): Promise<void> {
  loadEnv();

  const prompt = process.argv.slice(2).join(" ").trim();
  if (prompt === "") {
    console.error("usage: tsx scripts/ask-live.ts \"your question here\"");
    process.exit(1);
  }

  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (apiKey == null || apiKey === "") {
    console.error("[ask-live] GOOGLE_GENERATIVE_AI_API_KEY not set");
    process.exit(2);
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl == null || databaseUrl === "") {
    console.error("[ask-live] DATABASE_URL not set");
    process.exit(2);
  }

  const modelId = process.env.GOOGLE_MODEL ?? "gemini-2.5-flash";
  const google = createGoogleGenerativeAI({ apiKey });
  const model = google(modelId);

  const semanticPath = join(__dirname, "..", "semantic");
  const skillsPath = join(__dirname, "..", "skills");
  const sandboxRoot = await mkdtemp(join(tmpdir(), "ask-live-"));
  const filesystem = new InProcessSandboxFilesystem({ rootDir: sandboxRoot });
  const postgres = postgresAdapter({
    url: databaseUrl,
    readOnlyRole: "arivie_reader",
  });

  const user = {
    userId: "ask-live-cli",
    permissions: ["analytics:read"],
    dbRole: "arivie_reader",
  };

  const instance = await defineArivie({
    owner: {
      id: process.env.ARIVIE_OWNER_ID ?? "with-nextjs-owner",
      name: "ask-live CLI",
    },
    model,
    semantic: { path: semanticPath, mode: "preload" },
    skills: skillsPath,
    skillsMode: "auto",
    storage: postgres,
    sources: {
      postgres: {
        kind: "adapter",
        adapter: postgres,
        description: "Demo Postgres for this example script.",
      },
    },
    workspace: { filesystem },
    compileMetric: true,
    resolveUser: async () => user,
  });

  console.log(`\n→ model:    ${modelId}`);
  console.log(`→ question: ${prompt}\n`);

  const result = await runWithUserContext(user, async () =>
    // maxSteps defaults to 25 at the framework level (LimitConfig.maxSteps;
    // see make-agent.ts DEFAULT_MAX_STEPS); no per-call override needed.
    instance.agent.generate(prompt),
  );

  // Pretty-print: final text + every tool call across all steps.
  const record = result as Record<string, unknown>;
  const text =
    typeof record.text === "string" ? record.text : "(no text)";

  // Mastra puts tool calls inside response.messages[] as { role: 'assistant'|'tool', content: [...] }
  const response = record.response as { messages?: unknown[] } | undefined;
  const messages = Array.isArray(response?.messages) ? response.messages : [];
  let callIdx = 0;
  for (const msg of messages) {
    if (msg == null || typeof msg !== "object") continue;
    const m = msg as { role?: string; content?: unknown };
    const role = m.role ?? "?";
    const parts = Array.isArray(m.content) ? m.content : [];
    for (const part of parts) {
      if (part == null || typeof part !== "object") continue;
      const p = part as Record<string, unknown>;
      const type = String(p.type ?? "?");
      if (type === "tool-call") {
        console.log(`── tool-call[${callIdx}] (${role}): ${String(p.toolName ?? "?")}`);
        console.log(`   input: ${JSON.stringify(p.input ?? p.args ?? {}).slice(0, 800)}`);
      } else if (type === "tool-result") {
        const out = p.output ?? p.result ?? {};
        const outStr =
          typeof out === "object" && out !== null && "value" in out
            ? String((out as { value: unknown }).value)
            : JSON.stringify(out);
        console.log(`── tool-result[${callIdx}] (${role}): ${String(p.toolName ?? "?")}`);
        console.log(`   output: ${outStr.slice(0, 800)}`);
        callIdx += 1;
      }
    }
  }

  console.log(`\n── answer:\n${text}\n`);

  // Drain the Postgres pool so the process exits cleanly.
  await postgres.sql.end({ timeout: 5 });
  await rm(sandboxRoot, { recursive: true, force: true }).catch(() => undefined);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`\n[ask-live] ERROR: ${message}`);
  if (err instanceof Error && err.stack != null) {
    console.error(err.stack);
  }
  process.exit(1);
});
