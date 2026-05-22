/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Five-turn cross-role walkthrough. Hits five distinct SOP skills in
 * sequence, simulating a single workday across the org chart:
 *   1. GM (morning):        daily-sales-recap
 *   2. Exec Chef (mid):     food-cost-variance
 *   3. FOH Manager (afternoon): server-performance-scorecard
 *   4. Bookkeeper (close):  end-of-day-close
 *   5. Owner (Monday):      prime-cost-recap
 *
 * Captures a transcript to `transcripts/role-walkthrough-<ts>.txt`.
 *
 * Usage:
 *   pnpm -C arivie exec tsx examples/with-pos-fnb/scripts/role-walkthrough.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { defineArivie, localWorkspace, type ArivieInstance } from "@arivie/core";
import { postgresAdapter } from "@arivie/db-postgres";

const MATH_DISCIPLINE_PREFIX = `[SYSTEM RULE — read first]
All arithmetic in this turn MUST happen inside ONE \`execute_postgres\` call (CTE-chained), not in your response text. Do not combine outputs of multiple \`compile_metric\` calls with arithmetic. Do not compute variances, percentages, ratios, deltas, classifications, or aggregates in your reasoning trace. If a step truly cannot be expressed in SQL, STOP and surface that as a limitation — do not eyeball the math.

`;

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "..", ".env.local");
const semanticPath = join(__dirname, "..", "semantic");
const skillsPath = join(__dirname, "..", "skills");
const transcriptDir = join(__dirname, "..", "transcripts");

const RESOURCE_ID = "lumiere-chain-walkthrough";
const THREAD_ID = `walkthrough-${new Date().toISOString().slice(0, 19).replace(/[:-]/g, "")}`;

const TURNS: ReadonlyArray<{ role: string; prompt: string }> = [
  {
    role: "GM — morning",
    prompt:
      "I'm the GM at Lumière Bistro. Read the daily-sales-recap skill from ./skills/daily-sales-recap/SKILL.md, follow the playbook, then give me yesterday's recap for my outlet (luminere-bistro).",
  },
  {
    role: "Executive Chef — midday",
    prompt:
      "I'm the executive chef. Read ./skills/food-cost-variance/SKILL.md and run the playbook for the last 7 days across all three outlets. I want to know which kitchen is tightest and which is leaking.",
  },
  {
    role: "FOH Manager — afternoon",
    prompt:
      "I'm the FOH manager at Lumière Westside (luminere-westside). Read ./skills/server-performance-scorecard/SKILL.md and rank my servers + bartenders this week. Flag anyone whose comp or void rate is off.",
  },
  {
    role: "Bookkeeper — end of day",
    prompt:
      "I'm the bookkeeper. Read ./skills/end-of-day-close/SKILL.md and produce the close packet for Lumière Riverside for yesterday's business day.",
  },
  {
    role: "Owner — Monday morning",
    prompt:
      "I'm the chain owner. Read ./skills/prime-cost-recap/SKILL.md and give me the chain-level prime-cost picture for the last 7 days. Best and worst outlet, and any flags.",
  },
];

interface ToolCall {
  toolName: string;
  input: unknown;
}

interface TurnResult {
  role: string;
  prompt: string;
  toolCalls: ToolCall[];
  text: string;
  skillsRead: Set<string>;
}

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
    console.warn(`[walkthrough] could not read ${envPath}: ${String(err)}`);
  }
}

function extractCalls(result: unknown): { calls: ToolCall[]; skillsRead: Set<string> } {
  const calls: ToolCall[] = [];
  const skillsRead = new Set<string>();
  const record = result as Record<string, unknown>;
  const response = record.response as { messages?: unknown[] } | undefined;
  const messages = Array.isArray(response?.messages) ? response.messages : [];
  for (const msg of messages) {
    if (msg == null || typeof msg !== "object") continue;
    const parts = Array.isArray((msg as { content?: unknown }).content)
      ? ((msg as { content: unknown[] }).content)
      : [];
    for (const part of parts) {
      if (part == null || typeof part !== "object") continue;
      const p = part as Record<string, unknown>;
      const type = String(p.type ?? "");
      if (type === "tool-call") {
        const toolName = String(p.toolName ?? "?");
        const input = p.input ?? p.args ?? {};
        calls.push({ toolName, input });
        // Eager-mode skill tool: `skill({name})`
        // On-demand SkillSearchProcessor tools: `search_skills({query})`,
        // `load_skill({skillName})`, `skill_read({skillName, path})`
        if (
          toolName === "skill" ||
          toolName === "load_skill" ||
          toolName === "skill_read"
        ) {
          if (input != null && typeof input === "object") {
            const obj = input as Record<string, unknown>;
            const name =
              typeof obj.skillName === "string" ? obj.skillName
              : typeof obj.name === "string" ? obj.name
              : typeof obj.skill === "string" ? obj.skill
              : typeof obj.path === "string"
                ? (obj.path.match(/skills\/([^/]+)\/SKILL\.md/)?.[1] ?? null)
                : null;
            if (name) skillsRead.add(name);
          }
        }
        if (toolName.includes("workspace_read_file") || toolName === "read_file") {
          const path = (input as { path?: unknown }).path;
          if (typeof path === "string") {
            const m = path.match(/skills\/([^/]+)\/SKILL\.md/);
            if (m && m[1]) skillsRead.add(m[1]);
          }
        }
      }
    }
  }
  return { calls, skillsRead };
}

async function runTurn(
  instance: ArivieInstance,
  user: { userId: string; permissions: string[]; dbRole: string },
  turn: { role: string; prompt: string },
): Promise<TurnResult> {
  const result = await instance.ask({
    prompt: `${MATH_DISCIPLINE_PREFIX}${turn.prompt}`,
    user,
    thread: THREAD_ID,
    resource: RESOURCE_ID,
  });
  const { calls, skillsRead } = extractCalls(result.raw);
  return {
    role: turn.role,
    prompt: turn.prompt,
    toolCalls: calls,
    text: result.text || "(no text)",
    skillsRead,
  };
}

async function main(): Promise<void> {
  loadEnv();

  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (apiKey == null || apiKey === "") {
    console.error("[walkthrough] GOOGLE_GENERATIVE_AI_API_KEY not set");
    process.exit(2);
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl == null || databaseUrl === "") {
    console.error("[walkthrough] DATABASE_URL not set");
    process.exit(2);
  }

  const modelId = process.env.GOOGLE_MODEL ?? "gemini-2.5-flash";
  const google = createGoogleGenerativeAI({ apiKey });
  const model = google(modelId);

  const sandboxRoot = await mkdtemp(join(tmpdir(), "pos-walkthrough-"));
  const postgres = postgresAdapter({ url: databaseUrl, readOnlyRole: "arivie_reader" });

  const user = { userId: "walkthrough", permissions: ["analytics:read"], dbRole: "arivie_reader" };

  const instance = await defineArivie({
    owner: { id: process.env.ARIVIE_OWNER_ID ?? "lumiere-chain", name: "Lumière Chain" },
    model,
    semantic: { path: semanticPath, mode: "preload" },
    skills: skillsPath,
    skillsMode: "auto",
    sources: {
      postgres: {
        adapter: postgres,
        description: "Demo Postgres for this example script.",
      },
    },
    workspace: localWorkspace({ at: sandboxRoot }),
    compileMetric: true,
    resolveUser: async () => user,
  });

  console.log(`──────────────────────────────────────────────────────────`);
  console.log(`Lumière Chain — Role Walkthrough`);
  console.log(`model:  ${modelId}`);
  console.log(`turns:  ${TURNS.length}`);
  console.log(`──────────────────────────────────────────────────────────\n`);

  const allResults: TurnResult[] = [];
  for (let i = 0; i < TURNS.length; i += 1) {
    const turn = TURNS[i]!;
    console.log(`══ turn ${i + 1}/${TURNS.length}: ${turn.role} ══`);
    console.log(`USER: ${turn.prompt}\n`);
    const r = await runTurn(instance, user, turn);
    allResults.push(r);
    console.log(`AGENT: ${r.text.slice(0, 500)}${r.text.length > 500 ? "…" : ""}\n`);
    console.log(`tools called: ${r.toolCalls.map((c) => c.toolName).join(", ") || "(none)"}`);
    console.log(`skills read:  ${[...r.skillsRead].join(", ") || "(none)"}\n`);
  }

  // Transcript
  mkdirSync(transcriptDir, { recursive: true });
  const transcriptPath = join(transcriptDir, `role-walkthrough-${THREAD_ID}.txt`);
  const lines: string[] = [
    `Lumière Chain — Role Walkthrough`,
    `model: ${modelId}`,
    `thread: ${THREAD_ID}`,
    `timestamp: ${new Date().toISOString()}`,
    `==========================================================`,
  ];
  for (let i = 0; i < allResults.length; i += 1) {
    const r = allResults[i]!;
    lines.push(`\n── turn ${i + 1}: ${r.role} ──`);
    lines.push(`PROMPT: ${r.prompt}`);
    lines.push(`TOOL CALLS:`);
    for (const c of r.toolCalls) {
      lines.push(`  ${c.toolName}  ${JSON.stringify(c.input).slice(0, 300)}`);
    }
    lines.push(`SKILLS READ: ${[...r.skillsRead].join(", ") || "(none)"}`);
    lines.push(`ANSWER:`);
    lines.push(r.text);
  }
  writeFileSync(transcriptPath, lines.join("\n"), "utf8");
  console.log(`\n── transcript → ${transcriptPath}`);

  const allSkillsRead = new Set<string>();
  for (const r of allResults) for (const s of r.skillsRead) allSkillsRead.add(s);
  console.log(`\n── gate summary ──`);
  console.log(`skills read across walkthrough (${allSkillsRead.size}): ${[...allSkillsRead].sort().join(", ")}`);
  console.log(`status: ${allSkillsRead.size >= 4 ? "PASS (≥4 distinct skills)" : "FAIL (<4 skills auto-loaded)"}`);

  await postgres.sql.end({ timeout: 5 });
  await rm(sandboxRoot, { recursive: true, force: true }).catch(() => undefined);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
