/* SPDX-License-Identifier: Apache-2.0 */
/**
 * ask-live — fire a single prompt against a live LLM through Arivie.
 *
 * Demonstrates the v0.3 code-DX surface end-to-end:
 *   - `defineArivie({ skills, workspace: localWorkspace({...}), ... })`
 *     with skills + bash hoisted to the top level
 *   - `instance.ask({ prompt, user })` for a typed one-shot call
 *   - `result.text` / `result.toolCalls` / `result.sql` / `result.artifacts`
 *     all strictly typed — no `as any`, no `Record<string, unknown>` walks
 *
 * Provider auto-selection from .env.local (override with MODEL_PROVIDER):
 *   1. OPENAI_API_KEY                 → OpenAI (OPENAI_MODEL or "gpt-5-mini")
 *   2. XAI_API_KEY                    → xAI (XAI_MODEL or "grok-4.20-non-reasoning")
 *   3. GOOGLE_GENERATIVE_AI_API_KEY   → Gemini (GOOGLE_MODEL or "gemini-2.5-flash")
 *
 * Usage:
 *   pnpm -C arivie exec tsx examples/with-pos-fnb/scripts/ask-live.ts \
 *     --prompt "How did each outlet do yesterday? Write an HTML report."
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createXai } from "@ai-sdk/xai";
import { defineArivie, localWorkspace } from "@arivie/core";
import { postgresAdapter } from "@arivie/db-postgres";
import type { LanguageModel } from "ai";

function resolveModel(): {
  model: LanguageModel;
  provider: string;
  modelId: string;
} {
  const force = process.env.MODEL_PROVIDER?.toLowerCase();
  const openaiKey = process.env.OPENAI_API_KEY;
  const xaiKey = process.env.XAI_API_KEY;
  const googleKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  if (force === "openai" || (force == null && openaiKey != null && openaiKey !== "")) {
    if (!openaiKey) throw new Error("MODEL_PROVIDER=openai but OPENAI_API_KEY not set");
    const openai = createOpenAI({ apiKey: openaiKey });
    const modelId = process.env.OPENAI_MODEL ?? "gpt-5-mini";
    return { model: openai(modelId), provider: "openai", modelId };
  }

  if (force === "xai" || (force == null && xaiKey != null && xaiKey !== "")) {
    if (!xaiKey) throw new Error("MODEL_PROVIDER=xai but XAI_API_KEY not set");
    const xai = createXai({ apiKey: xaiKey });
    const modelId = process.env.XAI_MODEL ?? "grok-4.20-non-reasoning";
    return { model: xai(modelId), provider: "xai", modelId };
  }

  if (force === "google" || googleKey) {
    if (!googleKey)
      throw new Error("MODEL_PROVIDER=google but GOOGLE_GENERATIVE_AI_API_KEY not set");
    const google = createGoogleGenerativeAI({ apiKey: googleKey });
    const modelId = process.env.GOOGLE_MODEL ?? "gemini-2.5-flash";
    return { model: google(modelId), provider: "google", modelId };
  }

  throw new Error(
    "No model provider key set (OPENAI_API_KEY / XAI_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY)",
  );
}

/**
 * Math-discipline prefix. The agent prompt already pushes math into SQL
 * (HARD_CONSTRAINTS + REASONING_DISCIPLINE), but small models drift on
 * long tool chains. Repeating the rule per-turn is belt-and-suspenders:
 * cheap, and it kills the "approximate in prose" failure mode.
 */
const MATH_DISCIPLINE_PREFIX = `[SYSTEM RULE — read first]
All arithmetic in this turn MUST happen inside ONE \`execute_postgres\` call (CTE-chained), not in your response text. Do not combine outputs of multiple \`compile_metric\` calls with arithmetic. Do not compute variances, percentages, ratios, deltas, classifications, or aggregates in your reasoning trace.

For tasks that produce a file artifact (Markdown / HTML / CSV / chart), call \`mastra_workspace_write_file\` with the data formatted inline. Do NOT re-summarize numbers into prose first — copy the rows verbatim from your SQL result into the file.

`;

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "..", ".env.local");
const semanticPath = join(__dirname, "..", "semantic");
const skillsPath = join(__dirname, "..", "skills");
const workspaceRoot = resolve(__dirname, "..", "workspace");

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

function parsePrompt(): string {
  const argv = process.argv.slice(2);
  const idx = argv.indexOf("--prompt");
  if (idx >= 0 && idx < argv.length - 1) {
    return argv.slice(idx + 1).join(" ").trim();
  }
  return argv.join(" ").trim();
}

async function main(): Promise<void> {
  loadEnv();

  const prompt = parsePrompt();
  if (prompt === "") {
    console.error('usage: tsx scripts/ask-live.ts --prompt "your question"');
    process.exit(1);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl == null || databaseUrl === "") {
    console.error("[ask-live] DATABASE_URL not set");
    process.exit(2);
  }

  const { model, provider, modelId } = resolveModel();

  const pg = postgresAdapter({
    url: databaseUrl,
    readOnlyRole: "arivie_reader",
  });

  const instance = await defineArivie({
    owner: {
      id: process.env.ARIVIE_OWNER_ID ?? "lumiere-chain",
      name: "Lumière Chain",
    },
    model,
    semantic: { path: semanticPath, mode: "preload" },
    skills: skillsPath,
    skillsMode: "auto",
    storage: pg,
    sources: {
      postgres: {
        kind: "adapter",
        adapter: pg,
        description:
          "Lumière F&B operational Postgres — orders, outlets, customers, products, payments, shifts.",
        useWhen:
          "any revenue, orders, menu, outlet, customer, or staff-shift question",
      },
    },
    workspace: localWorkspace({ at: workspaceRoot, bash: true }),
    compileMetric: true,
    resolveUser: async () => ({
      userId: "ask-live-cli",
      permissions: ["analytics:read"],
      dbRole: "arivie_reader",
    }),
  });

  console.log(`\n→ provider:  ${provider}`);
  console.log(`→ model:     ${modelId}`);
  console.log(`→ workspace: ${workspaceRoot}`);
  console.log(`→ question:  ${prompt}\n`);

  const result = await instance.ask({
    prompt: `${MATH_DISCIPLINE_PREFIX}${prompt}`,
    user: {
      userId: "ask-live-cli",
      permissions: ["analytics:read"],
      dbRole: "arivie_reader",
    },
  });

  for (const [i, call] of result.toolCalls.entries()) {
    console.log(`── tool-call[${i}]: ${call.tool}`);
    console.log(`   input:  ${JSON.stringify(call.args).slice(0, 600)}`);
    if (call.output !== undefined) {
      const out = JSON.stringify(call.output).slice(0, 600);
      console.log(`   output: ${out}`);
    }
  }

  console.log(`\n── answer:\n${result.text}\n`);

  if (result.sql.length > 0) {
    console.log(`── sql (${result.sql.length} statement${result.sql.length === 1 ? "" : "s"}):`);
    for (const s of result.sql) console.log(`   ${s.slice(0, 200).replace(/\n/g, " ")}`);
  }

  const artifacts = listFilesRecursive(workspaceRoot);
  if (artifacts.length > 0) {
    console.log(`\n── workspace artifacts (${workspaceRoot}):`);
    for (const f of artifacts) console.log(`   ${f}`);
  } else {
    console.log(`\n── workspace artifacts: (none)`);
  }

  await instance.dispose();
}

function listFilesRecursive(dir: string, prefix = ""): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    const st = statSync(full);
    if (st.isDirectory()) out.push(...listFilesRecursive(full, rel));
    else out.push(`${rel}  (${st.size} bytes)`);
  }
  return out;
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`\n[ask-live] ERROR: ${message}`);
  if (err instanceof Error && err.stack != null) {
    console.error(err.stack);
  }
  process.exit(1);
});
