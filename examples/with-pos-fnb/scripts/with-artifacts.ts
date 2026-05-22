/* SPDX-License-Identifier: Apache-2.0 */
/**
 * with-artifacts — single Arivie agent producing real file artifacts in
 * one turn. SQL → write_file → (optional) shell exec, all in the same
 * agent's scratchpad. No supervisor, no sub-agents, no prose handoff.
 *
 * Demonstrates the v0.3 code-DX surface:
 *   - `localWorkspace({ at, bash: true })` one-liner
 *   - `instance.ask({ prompt, user })` typed call
 *   - `result.toolCalls` discriminated by tool, narrowed args
 *
 * Usage:
 *   pnpm -C arivie exec tsx examples/with-pos-fnb/scripts/with-artifacts.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { defineArivie, localWorkspace } from "@arivie/core";
import { postgresAdapter } from "@arivie/db-postgres";

const MATH_DISCIPLINE_PREFIX = `[SYSTEM RULE — read first]
All arithmetic in this turn MUST happen inside ONE \`execute_postgres\` call (CTE-chained), not in your response text. Do not combine outputs of multiple \`compile_metric\` calls with arithmetic.

For tasks that produce a file artifact (Markdown / HTML / CSV / JSON), call \`mastra_workspace_write_file\` with the data formatted inline. Copy each cell verbatim from your SQL result row into the file — do NOT round, do NOT summarize into prose first. For shell utilities (jq, awk, python), call \`workspace_bash\` directly with argv that has no shell metacharacters; stage scripts to a file first if you need pipelines.

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
    console.warn(`[with-artifacts] could not read ${envPath}: ${String(err)}`);
  }
}

async function main(): Promise<void> {
  loadEnv();

  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  const databaseUrl = process.env.DATABASE_URL;
  if (!apiKey) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY not set");
  if (!databaseUrl) throw new Error("DATABASE_URL not set");

  const google = createGoogleGenerativeAI({ apiKey });
  const modelId = process.env.GOOGLE_MODEL ?? "gemini-2.5-flash";
  const model = google(modelId);

  const user = {
    userId: "with-artifacts",
    permissions: ["analytics:read"],
    dbRole: "arivie_reader",
  };

  const pg = postgresAdapter({ url: databaseUrl, readOnlyRole: "arivie_reader" });

  const instance = await defineArivie({
    owner: { id: "lumiere-chain", name: "Lumière Chain" },
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
          "Lumière F&B operational Postgres — same schema as the main example.",
        useWhen:
          "any revenue, orders, menu, or outlet question when running the artifacts smoke",
      },
    },
    workspace: localWorkspace({ at: workspaceRoot, bash: true }),
    compileMetric: true,
    resolveUser: async () => user,
  });

  console.log(`──────────────────────────────────────────────────────────`);
  console.log(`Lumière Chain — single-agent artifacts demo`);
  console.log(`model:     ${modelId}`);
  console.log(`workspace: ${workspaceRoot}`);
  console.log(`──────────────────────────────────────────────────────────\n`);

  // ── Task A: file write
  const taskA = `${MATH_DISCIPLINE_PREFIX}Yesterday I want an end-of-day Markdown report for Lumière Bistro that I can email to ownership.

1. Pull yesterday's revenue, ticket count, covers, average check, comp% and void% for outlet_id 'luminere-bistro' via ONE \`execute_postgres\` query (single CTE, all numbers).
2. Call \`mastra_workspace_write_file\` to write the report to \`reports/eod-luminere-bistro-yesterday.md\`. The Markdown should have:
   - A heading with the outlet name and business_day
   - A KPI table with the six metrics
   - A one-line verdict ("Comp% breached" if > 3%, otherwise "Within target")
3. Confirm to me that the file was written.`;

  console.log("══ Task A: file write (end-of-day Markdown report) ══\n");
  const resA = await instance.ask({ prompt: taskA, user });

  console.log(`AGENT ANSWER:\n${resA.text}\n`);
  console.log(`tools called: ${resA.toolCalls.map((c) => c.tool).join(", ") || "(none)"}\n`);

  const reportPath = join(workspaceRoot, "reports", "eod-luminere-bistro-yesterday.md");
  if (existsSync(reportPath)) {
    const report = await readFile(reportPath, "utf8");
    console.log(`── wrote: ${reportPath}`);
    console.log("── report contents ──");
    console.log(report);
    console.log("── end report ──\n");
  } else {
    console.log(`── WARN: expected report not found at ${reportPath}\n`);
  }

  // ── Task B: shell exec
  const taskB = `${MATH_DISCIPLINE_PREFIX}I want to know which ingredient's waste cost grew the most week-over-week (last 7 days vs the 7 days before that), across the whole chain.

1. Pull a per-ingredient breakdown via ONE \`execute_postgres\` query that returns: ingredient_name, week_a_waste_cost (last 7 days), week_b_waste_cost (the 7 days before that). Use a CTE.
2. Write the rows to \`scratch/waste.json\` as a JSON array via \`mastra_workspace_write_file\`.
3. Write a small Python script to \`scratch/delta.py\` via \`mastra_workspace_write_file\` (use one statement per line — the sandbox rejects shell metacharacters in argv, so don't try \`python3 -c\` with inline pipelines). The script should load scratch/waste.json, compute (week_a - week_b), take the top 3 by absolute delta, and write the answer to \`scratch/answer.md\` as a Markdown bullet list ("- <name>: +$<delta>").
4. Call \`workspace_bash\` with argv \`["python3", "scratch/delta.py"]\`.
5. Read back \`scratch/answer.md\` and report the top 3 worst-trending ingredients verbatim.`;

  console.log("══ Task B: shell exec (Python over JSON, no inline metachars) ══\n");
  const resB = await instance.ask({ prompt: taskB, user });

  console.log(`AGENT ANSWER:\n${resB.text}\n`);
  console.log(`tools called: ${resB.toolCalls.map((c) => c.tool).join(", ") || "(none)"}\n`);

  const answerPath = join(workspaceRoot, "scratch", "answer.md");
  if (existsSync(answerPath)) {
    const answer = await readFile(answerPath, "utf8");
    console.log(`── wrote: ${answerPath}`);
    console.log("── answer contents ──");
    console.log(answer);
    console.log("── end answer ──\n");
  } else {
    console.log(`── WARN: expected answer not found at ${answerPath}\n`);
  }

  // ── Summary
  const writeCallsA = resA.toolCalls.filter((c) => c.tool === "mastra_workspace_write_file").length;
  const writeCallsB = resB.toolCalls.filter((c) => c.tool === "mastra_workspace_write_file").length;
  const bashCallsB = resB.toolCalls.filter((c) => c.tool === "workspace_bash").length;
  console.log(`── summary ──`);
  console.log(`Task A: write_file calls = ${writeCallsA}; file exists = ${existsSync(reportPath)}`);
  console.log(
    `Task B: write_file calls = ${writeCallsB}; bash calls = ${bashCallsB}; file exists = ${existsSync(answerPath)}`,
  );
  const pass =
    writeCallsA >= 1 &&
    existsSync(reportPath) &&
    writeCallsB >= 1 &&
    bashCallsB >= 1 &&
    existsSync(answerPath);
  console.log(`status: ${pass ? "PASS (agent produced both artifacts)" : "FAIL (see WARN above)"}`);

  await instance.dispose();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
