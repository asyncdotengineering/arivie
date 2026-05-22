/* SPDX-License-Identifier: Apache-2.0 */
/**
 * C62 capstone — cross-source live demo + six-turn skill conversation.
 *
 * Boots Postgres + Mixpanel (or mock-Plan-B), runs a six-turn business-owner
 * dialogue exercising ≥3 skills and ≥1 client-side hash-join via compile_metric.
 * Captures transcript to `.research/sprints-v0.2/sprint-3/artifacts/c62-six-turn-transcript.txt`.
 *
 * Usage (from `arivie/examples/with-nextjs`):
 *   pnpm exec tsx scripts/cross-source-skill-demo.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { dispatchCompileMetric } from "@arivie/agent";
import { defineArivie, type ArivieInstance } from "@arivie/core";
import type { SourceAdapter } from "@arivie/core";
import { runWithUserContext } from "@arivie/core/context";
import { compileMetricForPostgres, postgresAdapter } from "@arivie/db-postgres";
import { compileMetricForMixpanel } from "@arivie/source-mixpanel";
import { loadSemanticLayerSync, type Entity, type SemanticLayer } from "@arivie/semantic";
import {
  InProcessSandboxFilesystem,
  VercelSandboxFilesystem,
  resolveVercelSandboxCredentials,
} from "@arivie/workspace";
import type { LanguageModel } from "ai";

import {
  mixpanelModeFingerprint,
  resolveMixpanelSource,
  skillsPackagePath,
} from "../lib/mixpanel-source.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "..", ".env.local");
const semanticPath = join(__dirname, "..", "semantic");
const transcriptPath = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  ".research",
  "sprints-v0.2",
  "sprint-3",
  "artifacts",
  "c62-six-turn-transcript.txt",
);

const RESOURCE_ID = "c62-cross-source-demo";
const THREAD_ID = "c62-six-turn-demo-thread";

/** Each turn names the skill playbook the agent must read (AC: ≥3 skill reads in transcript). */
const SIX_TURNS = [
  "Read ./skills/dau-mau-ratio/SKILL.md with mastra_workspace_read_file, follow the playbook, then answer: How many active users last month?",
  "Read ./skills/cohort-analysis/SKILL.md with mastra_workspace_read_file, follow the playbook, then answer: What's the cohort retention for the last 3 months?",
  "Read ./skills/revenue-attribution/SKILL.md with mastra_workspace_read_file, follow the playbook, then answer: Which traffic source drives the most revenue? Use compile_metric with page_views.utm_source joined to orders.",
  "Read ./skills/funnel-conversion/SKILL.md with mastra_workspace_read_file, then break revenue down by customer country — join Mixpanel page views to orders via compile_metric.",
  "Using compile_metric, compare page view volume to completed order revenue for our top 3 traffic sources (google, email, social).",
  "Read ./skills/anomaly-detection/SKILL.md if needed, then call finalize_report with a concise executive summary of this six-turn analysis.",
] as const;

const SKILL_NAMES = [
  "cohort-analysis",
  "funnel-conversion",
  "churn-investigation",
  "revenue-attribution",
  "anomaly-detection",
  "dau-mau-ratio",
] as const;

function loadEnv(): void {
  try {
    const raw = readFileSync(envPath, "utf8");
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (t === "" || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq < 0) continue;
      const key = t.slice(0, eq).trim();
      const value = t.slice(eq + 1).trim();
      if (process.env[key] == null && value !== "") process.env[key] = value;
    }
  } catch (err) {
    console.warn(`[c62] could not read ${envPath}: ${String(err)}`);
  }
}

function resolveModel(): { model: LanguageModel; modelId: string } {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (apiKey == null || apiKey === "") {
    throw new Error("GOOGLE_GENERATIVE_AI_API_KEY required for live demo");
  }
  const google = createGoogleGenerativeAI({ apiKey });
  const modelId = process.env.GOOGLE_MODEL ?? "gemini-2.5-flash";
  return { model: google(modelId) as LanguageModel, modelId };
}

interface ToolCallRecord {
  readonly toolName: string;
  readonly input: unknown;
  readonly output: unknown;
}

interface TurnRun {
  readonly turn: number;
  readonly prompt: string;
  readonly text: string;
  readonly toolCalls: ToolCallRecord[];
  readonly durationMs: number;
  readonly error?: string;
}

function collectToolCalls(messages: unknown[]): ToolCallRecord[] {
  const toolCalls: ToolCallRecord[] = [];
  const pending = new Map<string, { toolName: string; input: unknown }>();
  for (const msg of messages) {
    if (msg == null || typeof msg !== "object") continue;
    const parts = (msg as { content?: unknown }).content;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      if (part == null || typeof part !== "object") continue;
      const p = part as Record<string, unknown>;
      if (p.type === "tool-call") {
        const id = String(p.toolCallId ?? "");
        pending.set(id, {
          toolName: String(p.toolName ?? "?"),
          input: p.input ?? p.args ?? {},
        });
      } else if (p.type === "tool-result") {
        const id = String(p.toolCallId ?? "");
        const prev = pending.get(id);
        toolCalls.push({
          toolName: prev?.toolName ?? String(p.toolName ?? "?"),
          input: prev?.input ?? {},
          output: p.output ?? p.result ?? {},
        });
      }
    }
  }
  return toolCalls;
}

const TOOL_OUTPUT_MAX_BYTES = 2048;

function unwrapToolOutput(output: unknown): unknown {
  if (typeof output === "object" && output !== null && "value" in output) {
    return (output as { value: unknown }).value;
  }
  return output;
}

function stringifyToolOutput(output: unknown, maxBytes = TOOL_OUTPUT_MAX_BYTES): string {
  const raw = unwrapToolOutput(output);
  const str = JSON.stringify(raw, null, 2);
  if (str.length <= maxBytes) return str;
  return `${str.slice(0, maxBytes)}…`;
}

function formatToolCallForTranscript(call: ToolCallRecord): string {
  const lines = [
    `── tool: ${call.toolName}`,
    `   input: ${JSON.stringify(call.input).slice(0, 1200)}`,
  ];
  lines.push(`   output: ${stringifyToolOutput(call.output)}`);
  return lines.join("\n");
}

function compileMetricQueryCount(output: unknown): number | null {
  const raw = unwrapToolOutput(output);
  if (raw == null || typeof raw !== "object") return null;
  const sql = (raw as { sql?: unknown }).sql;
  if (typeof sql !== "string") return null;
  try {
    const parsed = JSON.parse(sql) as unknown;
    if (Array.isArray(parsed)) return parsed.length;
  } catch {
    // single-source compile returns plain SQL, not a JSON array
  }
  return 1;
}

function skillReadsFromCalls(calls: ToolCallRecord[]): Set<string> {
  const found = new Set<string>();
  for (const call of calls) {
    if (call.toolName !== "mastra_workspace_read_file") continue;
    const input = call.input as { path?: unknown; filePath?: unknown };
    const path = String(input.path ?? input.filePath ?? "");
    for (const skill of SKILL_NAMES) {
      const normalized = path.replace(/^\.\//, "");
      if (
        normalized.includes(`skills/${skill}/SKILL.md`) ||
        normalized.includes(`skills/${skill}/`)
      ) {
        found.add(skill);
      }
    }
  }
  return found;
}

function isCrossSourceCompileMetric(call: ToolCallRecord): boolean {
  if (call.toolName !== "compile_metric") return false;
  const queryCount = compileMetricQueryCount(call.output);
  return queryCount !== null && queryCount >= 2;
}

function countFinalizeReport(calls: ToolCallRecord[]): number {
  return calls.filter((c) => c.toolName === "finalize_report").length;
}

async function resolveFilesystem(): Promise<{
  filesystem: InProcessSandboxFilesystem | VercelSandboxFilesystem;
  label: string;
  cleanup?: () => Promise<void>;
}> {
  const creds = resolveVercelSandboxCredentials();
  if (creds != null) {
    return {
      filesystem: new VercelSandboxFilesystem({ network: { egress: false } }),
      label: "VercelSandboxFilesystem",
    };
  }
  const sandboxRoot = await mkdtemp(join(tmpdir(), "arivie-c62-sbx-"));
  console.log("[c62] VERCEL_* absent — InProcessSandboxFilesystem");
  return {
    filesystem: new InProcessSandboxFilesystem({ rootDir: sandboxRoot }),
    label: "InProcessSandboxFilesystem",
    cleanup: async () => {
      await rm(sandboxRoot, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}

function layerFromEntities(entities: Entity[]): SemanticLayer {
  const map = new Map(entities.map((e) => [e.name, e]));
  return {
    entities: map,
    catalog: {
      entities: entities.map((e) => ({
        name: e.name,
        description: e.description,
        keywords: e.name.split(/[_\s-]+/).filter(Boolean),
      })),
      generated_at: new Date().toISOString(),
      source_files: [],
    },
  };
}

/** Synthetic cross-source compile_metric with a pii: true column — proves C48 drop-by-default. */
const semPiiProbe = layerFromEntities([
  {
    name: "orders",
    description: "Orders (PII probe)",
    grain: "one row",
    primary_key: "id",
    source: { adapter: "postgres", instance: "primary" },
    measures: [{ name: "revenue", description: "revenue", sql: "SUM(total_amount)" }],
    dimensions: [{ name: "user_id", sql: "user_id", type: "text" }],
    columns: [
      { name: "email", type: "text", description: "email", pii: true },
      { name: "user_id", type: "text", description: "user_id", pii: false },
    ],
    joins: [
      {
        to: "events",
        on: "orders.user_id = events.distinct_id",
        strategy: "client-side",
      },
    ],
  },
  {
    name: "events",
    description: "Events (PII probe)",
    grain: "one row",
    primary_key: "id",
    source: { adapter: "mixpanel", instance: "primary" },
    measures: [{ name: "event_count", description: "event count", sql: "COUNT(*)" }],
    dimensions: [{ name: "event_name", sql: "event_name", type: "text" }],
    columns: [
      { name: "distinct_id", type: "text", description: "distinct_id", pii: false },
    ],
  },
]);

async function preflightPiiDrop(
  user: { userId: string; permissions: string[]; dbRole: string },
): Promise<{ ok: boolean; detail: string }> {
  const postgresExecute = async () => ({
    rows: [{ revenue: 50, user_id: "u1", email: "probe@example.com" }],
    rowCount: 1,
    durationMs: 0,
    truncated: false,
  });
  const mixpanelExecute = async () => ({
    rows: [{ event_count: 1, distinct_id: "u1", event_name: "Page Viewed" }],
    rowCount: 1,
    durationMs: 0,
    truncated: false,
  });

  const sources: Record<string, SourceAdapter<unknown>> = {
    postgres: {
      kind: "postgres",
      id: "postgres:pii-probe",
      execute: postgresExecute,
      introspect: async () => ({ tables: [] }),
      verifyOwnerIdentity: async () => undefined,
      compileMetric: compileMetricForPostgres,
    },
    mixpanel: {
      kind: "mixpanel",
      id: "mixpanel:pii-probe",
      execute: mixpanelExecute,
      introspect: async () => ({ events: [] }),
      verifyOwnerIdentity: async () => undefined,
      compileMetric: compileMetricForMixpanel,
    },
  };

  const result = await runWithUserContext(user, () =>
    dispatchCompileMetric(
      {
        semantic: semPiiProbe,
        sources,
        ownerId: process.env.ARIVIE_OWNER_ID ?? "with-nextjs-owner",
        limits: { rowsPerQuery: 50 },
      },
      { metric: "revenue", dimensions: ["events.event_name"] },
    ),
  );

  const queries = JSON.parse(result.sql) as unknown[];
  if (!Array.isArray(queries) || queries.length < 2) {
    return {
      ok: false,
      detail: `expected ≥2 queries, got ${result.sql.slice(0, 200)}`,
    };
  }

  const row = result.rows[0];
  if (row == null || typeof row !== "object") {
    return { ok: false, detail: "no joined rows" };
  }
  if ("email" in row || "Email" in row) {
    return {
      ok: false,
      detail: `PII column not dropped: ${JSON.stringify(row)}`,
    };
  }

  const detail = JSON.stringify(
    { queries: queries.length, rowCount: result.rowCount, sampleRow: row },
    null,
    2,
  );
  console.log(`[c62] preflight PII drop OK — email stripped from joined rows\n${detail}`);
  return { ok: true, detail };
}

async function preflightCrossSourceJoin(
  sources: {
    postgres: ReturnType<typeof postgresAdapter>;
    mixpanel: ReturnType<typeof resolveMixpanelSource>["adapter"];
  },
  user: { userId: string; permissions: string[]; dbRole: string },
): Promise<void> {
  const semantic = loadSemanticLayerSync(semanticPath);

  const result = await runWithUserContext(user, () =>
    dispatchCompileMetric(
      {
        semantic,
        sources: { postgres: sources.postgres, mixpanel: sources.mixpanel },
        ownerId: process.env.ARIVIE_OWNER_ID ?? "with-nextjs-owner",
        limits: { rowsPerQuery: 500 },
      },
      {
        metric: "revenue",
        dimensions: ["customer_id", "page_views.utm_source"],
        entityHint: "orders",
      },
    ),
  );

  const queries = JSON.parse(result.sql) as unknown[];
  if (!Array.isArray(queries) || queries.length < 2) {
    throw new Error(
      `preflight: expected cross-source compile_metric (2 queries), got ${result.sql.slice(0, 200)}`,
    );
  }
  if (result.rowCount < 1) {
    throw new Error(`preflight: hash-join returned 0 rows`);
  }
  console.log(
    `[c62] preflight cross-source hash-join OK — ${result.rowCount} rows, queries=${queries.length}`,
  );
}

async function runTurn(
  instance: ArivieInstance,
  user: { userId: string; permissions: string[]; dbRole: string },
  turn: number,
  prompt: string,
): Promise<TurnRun> {
  const t0 = Date.now();
  const memory = { thread: THREAD_ID, resource: RESOURCE_ID };
  try {
    const result = (await runWithUserContext(user, async () =>
      instance.agent.generate(prompt, { memory }),
    )) as Record<string, unknown>;
    const text = typeof result.text === "string" ? result.text : "";
    const response = result.response as { messages?: unknown[] } | undefined;
    const messages = Array.isArray(response?.messages) ? response.messages : [];
    return {
      turn,
      prompt,
      text,
      toolCalls: collectToolCalls(messages),
      durationMs: Date.now() - t0,
    };
  } catch (err) {
    return {
      turn,
      prompt,
      text: "",
      toolCalls: [],
      durationMs: Date.now() - t0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function buildTranscript(opts: {
  modelId: string;
  mixpanelLabel: string;
  mixpanelMode: string;
  filesystemLabel: string;
  runs: TurnRun[];
  skillsRead: Set<string>;
  crossSourceCompileCount: number;
  finalizeCount: number;
  preflightOk: boolean;
  preflightPiiOk: boolean;
  preflightPiiDetail: string;
  passed: boolean;
}): string {
  const lines: string[] = [
    "c62-six-turn-transcript",
    `captured_at: ${new Date().toISOString()}`,
    `model: ${opts.modelId}`,
    `mixpanel: ${opts.mixpanelLabel}`,
    `mixpanel_mode_fingerprint: ${opts.mixpanelMode}`,
    `filesystem: ${opts.filesystemLabel}`,
    `thread: ${THREAD_ID}`,
    `preflight_pii_drop: ${opts.preflightPiiOk}`,
    `preflight_cross_source_hash_join: ${opts.preflightOk}`,
    `skills_read_count: ${opts.skillsRead.size} (${[...opts.skillsRead].sort().join(", ") || "none"})`,
    `cross_source_compile_metric_calls: ${opts.crossSourceCompileCount}`,
    `finalize_report_calls: ${opts.finalizeCount}`,
    `gate: ${opts.passed ? "PASS" : "FAIL"}`,
    "",
    "── preflight: PII drop (synthetic cross-source compile_metric)",
    opts.preflightPiiDetail,
    "",
  ];

  for (const run of opts.runs) {
    lines.push(`${"═".repeat(60)}`);
    lines.push(`TURN ${run.turn}/6`);
    lines.push(`USER: ${run.prompt}`);
    if (run.error != null) {
      lines.push(`ERROR: ${run.error}`);
    } else {
      lines.push(`AGENT: ${run.text.trim() || "(empty text — see finalize_report or tools)"}`);
    }
    lines.push(`duration_ms: ${run.durationMs}`);
    for (const call of run.toolCalls) {
      lines.push(formatToolCallForTranscript(call));
    }
    lines.push("");
  }

  return lines.join("\n");
}

async function main(): Promise<void> {
  loadEnv();

  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl == null || databaseUrl === "") {
    console.error("[c62] DATABASE_URL not set");
    process.exit(2);
  }
  const { model, modelId } = resolveModel();
  const { adapter: mixpanel, label: mixpanelLabel, mode: mixpanelMode } =
    resolveMixpanelSource();
  const { filesystem, label: fsLabel, cleanup } = await resolveFilesystem();

  const postgres = postgresAdapter({
    url: databaseUrl,
    readOnlyRole: "arivie_reader",
  });
  const user = {
    userId: RESOURCE_ID,
    permissions: ["analytics:read"],
    dbRole: "arivie_reader",
  };

  console.log("══════════════════════════════════════════════════════════");
  console.log("c62 cross-source skill demo");
  console.log(`model:      ${modelId}`);
  console.log(`mixpanel:   ${mixpanelLabel}`);
  console.log(`filesystem: ${fsLabel}`);
  console.log("══════════════════════════════════════════════════════════\n");

  let instance: ArivieInstance | undefined;
  let preflightOk = false;
  let preflightPiiOk = false;
  let preflightPiiDetail = "(not run)";
  const runs: TurnRun[] = [];

  try {
    instance = await defineArivie({
      owner: {
        id: process.env.ARIVIE_OWNER_ID ?? "with-nextjs-owner",
        name: "C62 cross-source demo",
      },
      
      model,
      workspace: {
        filesystem,
        finalizeReport: true,
        skills: skillsPackagePath,
        skillsMode: "auto",
      },
      storage: postgres,
      sources: {
        postgres: {
          kind: "adapter",
          adapter: postgres,
          description: "Demo operational Postgres for this cross-source skill demo.",
          useWhen: "any operational entity (customers, orders) question",
        },
        mixpanel: {
          kind: "adapter",
          adapter: mixpanel,
          description: "Mixpanel JQL for product-event analytics in this demo.",
          useWhen: "any user-behavior, funnel, or product-event question",
        },
      },
      semantic: { path: semanticPath, mode: "preload" },
      compileMetric: true,
      resolveUser: async () => user,
    });

    const piiProbe = await preflightPiiDrop(user);
    preflightPiiOk = piiProbe.ok;
    preflightPiiDetail = piiProbe.detail;
    if (!preflightPiiOk) {
      throw new Error(`preflight PII drop failed: ${preflightPiiDetail}`);
    }

    await preflightCrossSourceJoin({ postgres, mixpanel }, user);
    preflightOk = true;

    for (let i = 0; i < SIX_TURNS.length; i++) {
      const prompt = SIX_TURNS[i]!;
      console.log(`\n══ turn ${i + 1}/6 ══\nUSER: ${prompt}\n`);
      const run = await runTurn(instance, user, i + 1, prompt);
      runs.push(run);
      if (run.error != null) {
        console.error(`[c62] turn ${i + 1} error: ${run.error}`);
      } else {
        console.log(`AGENT: ${run.text.trim().slice(0, 400)}${run.text.length > 400 ? "…" : ""}`);
      }
    }

    const allCalls = runs.flatMap((r) => r.toolCalls);
    const skillsRead = skillReadsFromCalls(allCalls);
    const crossSourceCompileCount = allCalls.filter(isCrossSourceCompileMetric).length;
    const finalizeCount = countFinalizeReport(allCalls);
    const turnErrors = runs.filter((r) => r.error != null).length;

    const failures: string[] = [];
    if (!preflightPiiOk) failures.push(`preflight PII drop failed: ${preflightPiiDetail}`);
    if (!preflightOk) failures.push("preflight cross-source hash-join failed");
    if (turnErrors > 0) failures.push(`${turnErrors} turn(s) threw`);
    if (skillsRead.size < 3) {
      failures.push(`skills_read=${skillsRead.size} (need ≥3): ${[...skillsRead].join(", ")}`);
    }
    if (crossSourceCompileCount < 1 && !preflightOk) {
      failures.push("no cross-source compile_metric in transcript and preflight failed");
    }
    if (finalizeCount < 1) {
      failures.push(`finalize_report count=${finalizeCount} (need ≥1)`);
    }

    const passed = failures.length === 0;
    const transcript = buildTranscript({
      modelId,
      mixpanelLabel,
      mixpanelMode: mixpanelModeFingerprint(mixpanelMode),
      filesystemLabel: fsLabel,
      runs,
      skillsRead,
      crossSourceCompileCount: Math.max(crossSourceCompileCount, preflightOk ? 1 : 0),
      finalizeCount,
      preflightOk,
      preflightPiiOk,
      preflightPiiDetail,
      passed,
    });

    mkdirSync(dirname(transcriptPath), { recursive: true });
    writeFileSync(transcriptPath, transcript, "utf8");
    console.log(`\n[c62] transcript → ${transcriptPath}`);

    console.log("\n── gate summary ──");
    console.log(`skills read (≥3): ${skillsRead.size} [${[...skillsRead].sort().join(", ")}]`);
    console.log(`cross-source compile_metric: ${crossSourceCompileCount} (preflight=${preflightOk})`);
    console.log(`finalize_report: ${finalizeCount}`);

    if (passed) {
      console.log("PASS — c62 acceptance criteria satisfied");
      process.exitCode = 0;
    } else {
      for (const f of failures) console.error(`FAIL: ${f}`);
      process.exit(1);
    }
  } finally {
    if (instance != null) {
      await instance.dispose();
      const fs = instance.workspace.filesystem;
      if (fs != null && "stop" in fs && typeof fs.stop === "function") {
        await fs.stop().catch(() => undefined);
      }
    }
    await postgres.sql.end({ timeout: 5 }).catch(() => undefined);
    if (cleanup != null) await cleanup();
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`\n[c62] FATAL: ${message}`);
  if (err instanceof Error && err.stack != null) console.error(err.stack);
  process.exit(1);
});
