/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Sprint 1 lightweight dogfood eval runner (12 golden-SQL probes).
 * Full @arivie/eval package ships in Sprint 5 C32.
 */
import { execSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { parse as parseYaml } from "yaml";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { postgresAdapter } from "@arivie/db-postgres";
import { runWithUserContext } from "@arivie/core/context";
import { defineArivie } from "@arivie/core";
import { extractExecuteSql, resultsEqual } from "@arivie/core/eval";
import { createEvalMockModel } from "./eval-mock-model.js";

export type EvalMode = "preload" | "browse" | "rag";

const EVAL_MODES: readonly EvalMode[] = ["preload", "browse", "rag"];

export function parseEvalArgv(argv: string[]): { mode: EvalMode } {
  let mode: EvalMode = "preload";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--mode" || arg === "-m") {
      const next = argv[i + 1];
      if (next != null && (EVAL_MODES as readonly string[]).includes(next)) {
        mode = next as EvalMode;
        i += 1;
      }
    } else if (arg?.startsWith("--mode=")) {
      const value = arg.slice("--mode=".length);
      if ((EVAL_MODES as readonly string[]).includes(value)) {
        mode = value as EvalMode;
      }
    }
  }
  return { mode };
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARIVIE_ROOT = join(__dirname, "..");
const PROBES_DIR = join(ARIVIE_ROOT, "evals", "golden-queries");
const SEMANTIC_DIR = join(ARIVIE_ROOT, "evals", "semantic");
const SEED_SQL = join(__dirname, "seed-dogfood.sql");
const ARTIFACT_PATH = join(
  ARIVIE_ROOT,
  "..",
  ".research",
  "sprints",
  "sprint-1",
  "artifacts",
  "eval-output.txt",
);

type ProbeCategory = "normal" | "ambiguous" | "zero-row";

type ValidationRule =
  | { result_has_rows: boolean }
  | { column_exists: string }
  | { value_positive: string }
  | { max_rows: number }
  | { assumption_states: string[] }
  | { tool_calls_min: number }
  | { answer_must_not_claim_zero_revenue: boolean };

interface Probe {
  id: string;
  category: ProbeCategory;
  question: string;
  golden_sql: string;
  validation: ValidationRule[];
}

interface ProbeRun {
  id: string;
  category: ProbeCategory;
  pass: boolean;
  failures: string[];
  agentSql: string | null;
  durationMs: number;
}

function dockerAvailable(): boolean {
  try {
    execSync("docker info", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function loadEnvFiles(): Promise<void> {
  const { readFile: readEnv } = await import("node:fs/promises");
  const candidates = [
    join(ARIVIE_ROOT, ".env"),
    join(ARIVIE_ROOT, "..", ".env"),
  ];
  for (const path of candidates) {
    try {
      const raw = await readEnv(path, "utf8");
      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.length === 0 || trimmed.startsWith("#")) {
          continue;
        }
        const eq = trimmed.indexOf("=");
        if (eq <= 0) {
          continue;
        }
        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        if (process.env[key] === undefined) {
          process.env[key] = value;
        }
      }
    } catch {
      // optional .env
    }
  }
}

function resolveModel(probes: Probe[]): {
  model: LanguageModel;
  label: string;
} {
  if (process.env.ANTHROPIC_API_KEY) {
    const modelId = process.env.EVAL_MODEL ?? "claude-sonnet-4-20250514";
    return { model: anthropic(modelId), label: `anthropic/${modelId}` };
  }
  if (process.env.OPENAI_API_KEY) {
    const modelId = process.env.EVAL_MODEL ?? "gpt-4o-mini";
    return { model: openai(modelId), label: `openai/${modelId}` };
  }
  if (process.env.EVAL_ALLOW_MOCK !== "0") {
    return {
      model: createEvalMockModel(probes),
      label: "eval-mock (no API key — set ANTHROPIC_API_KEY for live LLM eval)",
    };
  }
  throw new Error(
    "Set ANTHROPIC_API_KEY or OPENAI_API_KEY for live eval, or EVAL_ALLOW_MOCK=1 for fixture mode.",
  );
}

function readerConnectionUrl(superuserUrl: string): string {
  const url = new URL(superuserUrl);
  url.username = "arivie_reader";
  url.password = "test-arivie-reader";
  return url.toString();
}

async function loadProbes(): Promise<Probe[]> {
  const files = (await readdir(PROBES_DIR))
    .filter((name) => name.endsWith(".yml"))
    .sort();
  const probes: Probe[] = [];
  for (const file of files) {
    const raw = await readFile(join(PROBES_DIR, file), "utf8");
    const parsed = parseYaml(raw) as Probe;
    probes.push(parsed);
  }
  return probes;
}

function countExecuteCalls(toolResults: unknown): number {
  if (!Array.isArray(toolResults)) {
    return 0;
  }
  return toolResults.filter((entry) => {
    if (entry == null || typeof entry !== "object") {
      return false;
    }
    const record = entry as Record<string, unknown>;
    const payload =
      record.payload != null && typeof record.payload === "object"
        ? (record.payload as Record<string, unknown>)
        : undefined;
    const toolName =
      (typeof record.toolName === "string" && record.toolName) ||
      (typeof payload?.toolName === "string" && payload.toolName) ||
      (typeof record.name === "string" && record.name) ||
      (typeof record.tool === "string" && record.tool);
    return toolName === "execute";
  }).length;
}

function answerClaimsZeroRevenue(text: string): boolean {
  const lower = text.toLowerCase();
  const zeroPhrases = [
    "revenue is 0",
    "revenue was 0",
    "revenue is $0",
    "no revenue",
    "zero revenue",
    "revenue of 0",
  ];
  const investigates =
    lower.includes("investigate") ||
    lower.includes("no rows") ||
    lower.includes("empty") ||
    lower.includes("shipped") ||
    lower.includes("status");
  if (investigates) {
    return false;
  }
  return zeroPhrases.some((phrase) => lower.includes(phrase));
}

function runValidationRules(
  rules: ValidationRule[],
  ctx: {
    rows: Record<string, unknown>[];
    answerText: string;
    toolCallCount: number;
  },
): string[] {
  const failures: string[] = [];
  for (const rule of rules) {
    if ("result_has_rows" in rule) {
      const want = rule.result_has_rows;
      const has = ctx.rows.length > 0;
      if (want !== has) {
        failures.push(`result_has_rows: expected ${want}, got ${has}`);
      }
    }
    if ("column_exists" in rule) {
      const col = rule.column_exists;
      const found = ctx.rows.some((row) => Object.prototype.hasOwnProperty.call(row, col));
      if (!found) {
        failures.push(`column_exists: missing column ${col}`);
      }
    }
    if ("value_positive" in rule) {
      const col = rule.value_positive;
      const values = ctx.rows.map((row) => row[col]);
      const ok = values.some((v) => {
        const n = Number(v);
        return Number.isFinite(n) && n > 0;
      });
      if (!ok) {
        failures.push(`value_positive: ${col} is not positive`);
      }
    }
    if ("max_rows" in rule) {
      if (ctx.rows.length > rule.max_rows) {
        failures.push(`max_rows: ${ctx.rows.length} > ${rule.max_rows}`);
      }
    }
    if ("assumption_states" in rule) {
      const lower = ctx.answerText.toLowerCase();
      for (const phrase of rule.assumption_states) {
        if (!lower.includes(phrase.toLowerCase())) {
          failures.push(`assumption_states: missing "${phrase}" in answer`);
        }
      }
    }
    if ("tool_calls_min" in rule) {
      if (ctx.toolCallCount < rule.tool_calls_min) {
        failures.push(
          `tool_calls_min: ${ctx.toolCallCount} < ${rule.tool_calls_min}`,
        );
      }
    }
    if ("answer_must_not_claim_zero_revenue" in rule) {
      if (answerClaimsZeroRevenue(ctx.answerText)) {
        failures.push("answer_must_not_claim_zero_revenue: answer claims zero revenue without investigation");
      }
    }
  }
  return failures;
}

async function runProbe(
  probe: Probe,
  instance: ReturnType<typeof defineArivie>,
  db: ReturnType<typeof postgresAdapter>,
): Promise<ProbeRun> {
  const started = Date.now();
  const failures: string[] = [];
  let agentSql: string | null = null;
  let agentRows: Record<string, unknown>[] = [];
  let answerText = "";
  let toolCallCount = 0;

  const user = {
    userId: "eval-user",
    permissions: [] as string[],
    dbRole: "arivie_reader",
  };

  try {
    const result = await runWithUserContext(user, async () => {
      return instance.agent.generate(
        [{ role: "user" as const, content: probe.question }],
        {
          memory: {
            thread: `eval-${probe.id}`,
            resource: user.userId,
          },
        },
      );
    });

    answerText =
      typeof result.text === "string"
        ? result.text
        : typeof (result as { text?: unknown }).text === "string"
          ? String((result as { text: string }).text)
          : "";

    const toolResults = result.toolResults ?? [];
    const steps = (result as { steps?: unknown }).steps;
    const stepToolResults = Array.isArray(steps)
      ? steps.flatMap((step) =>
          step != null && typeof step === "object"
            ? ((step as { toolResults?: unknown }).toolResults ?? [])
            : [],
        )
      : [];
    const mergedToolResults = [
      ...(Array.isArray(toolResults) ? toolResults : []),
      ...(Array.isArray(stepToolResults) ? stepToolResults : []),
    ];
    toolCallCount = countExecuteCalls(mergedToolResults);
    agentSql = extractExecuteSql(mergedToolResults, steps);

    if (agentSql == null) {
      failures.push("agent did not emit execute SQL");
    } else {
      const executed = await db.execute({
        query: agentSql,
        runAsRole: user.dbRole,
        userId: user.userId,
        rowLimit: 500,
        timeoutMs: 30_000,
      });
      agentRows = executed.rows;
    }
  } catch (err) {
    failures.push(
      `agent error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let goldenRows: Record<string, unknown>[] = [];
  try {
    const golden = await db.execute({
      query: probe.golden_sql.trim(),
      runAsRole: user.dbRole,
      userId: user.userId,
      rowLimit: 500,
      timeoutMs: 30_000,
    });
    goldenRows = golden.rows;
  } catch (err) {
    failures.push(
      `golden_sql error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const compareResults =
    probe.category === "normal" || probe.category === "ambiguous";
  if (
    compareResults &&
    agentSql != null &&
    failures.every((f) => !f.startsWith("agent error"))
  ) {
    if (!resultsEqual(agentRows, goldenRows)) {
      failures.push("resultsEqual: agent SQL result differs from golden SQL");
    }
  }

  failures.push(
    ...runValidationRules(probe.validation, {
      rows: agentRows,
      answerText,
      toolCallCount,
    }),
  );

  return {
    id: probe.id,
    category: probe.category,
    pass: failures.length === 0,
    failures,
    agentSql,
    durationMs: Date.now() - started,
  };
}

export interface RunDogfoodEvalResult {
  passed: number;
  total: number;
  exitCode: number;
  mode: EvalMode;
  lines: string[];
}

export async function runDogfoodEval(options: {
  mode: EvalMode;
}): Promise<RunDogfoodEvalResult> {
  const lines: string[] = [];
  const log = (line: string) => {
    console.log(line);
    lines.push(line);
  };

  if (!dockerAvailable()) {
    log("ERROR: Docker is required for testcontainers Postgres.");
    await writeArtifact(lines);
    return {
      passed: 0,
      total: 0,
      exitCode: 1,
      mode: options.mode,
      lines,
    };
  }

  await loadEnvFiles();
  const probes = await loadProbes();
  const { model, label } = resolveModel(probes);
  log(`Arivie S1 dogfood eval — model: ${label} — mode: ${options.mode}`);
  if (label.startsWith("eval-mock")) {
    log(
      "NOTE: Mock mode exercises defineArivie + execute tools with golden SQL; re-run with ANTHROPIC_API_KEY for real agent quality.",
    );
  }
  log("");

  const container = await new PostgreSqlContainer("postgres:16-alpine").start();
  const connectionUrl = container.getConnectionUri();
  const readerUrl = readerConnectionUrl(connectionUrl);

  const setupDb = postgresAdapter({ url: connectionUrl });
  try {
    await setupDb.setupRole("arivie_reader");
    await setupDb.sql.unsafe(
      `ALTER ROLE arivie_reader WITH LOGIN PASSWORD 'test-arivie-reader'`,
    );
    const seedSql = await readFile(SEED_SQL, "utf8");
    await setupDb.sql.unsafe(seedSql);
    await setupDb.sql`
      INSERT INTO arivie_owner_identity (key, value)
      VALUES ('owner_id', 'dogfood-owner')
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `;
    await setupDb.sql.unsafe(`GRANT SELECT ON TABLE orders TO arivie_reader`);
  } finally {
    await setupDb.sql.end();
  }

  const db = postgresAdapter({ url: connectionUrl });
  const readerDb = postgresAdapter({ url: readerUrl });
  const instance = defineArivie({
    owner: { id: "dogfood-owner", name: "Dogfood" },
    model,
    db,
    semantic: { path: SEMANTIC_DIR, mode: options.mode },
    resolveUser: async () => ({
      userId: "eval-user",
      permissions: [],
      dbRole: "arivie_reader",
    }),
    limits: { rowsPerQuery: 500, queryTimeoutMs: 30_000 },
  });

  const storage = instance.mastra.getStorage();
  if (
    storage != null &&
    "init" in storage &&
    typeof storage.init === "function"
  ) {
    await storage.init();
  }

  await runWithUserContext(
    {
      userId: "eval-user",
      permissions: [],
      dbRole: "arivie_reader",
    },
    async () => {
      await instance.agent.generate("warmup", {
        memory: { thread: "eval-warmup", resource: "eval-user" },
      });
    },
  );

  const setupForMastra = postgresAdapter({ url: connectionUrl });
  const mastraTables = await setupForMastra.sql<{ tablename: string }[]>`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public' AND tablename LIKE 'mastra_%'
  `;
  for (const row of mastraTables) {
    await setupForMastra.sql.unsafe(
      `ALTER TABLE public.${row.tablename} OWNER TO arivie_reader`,
    );
    await setupForMastra.sql.unsafe(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.${row.tablename} TO arivie_reader`,
    );
  }
  await setupForMastra.sql.unsafe(
    `GRANT USAGE, CREATE ON SCHEMA public TO arivie_reader`,
  );
  await setupForMastra.sql.end();

  const results: ProbeRun[] = [];

  for (const probe of probes) {
    log(`--- ${probe.id} (${probe.category}) ---`);
    log(`Q: ${probe.question}`);
    const run = await runProbe(probe, instance, readerDb);
    results.push(run);
    if (run.agentSql) {
      log(`SQL: ${run.agentSql.slice(0, 200)}${run.agentSql.length > 200 ? "…" : ""}`);
    }
    if (run.pass) {
      log(`PASS (${run.durationMs}ms)`);
    } else {
      log(`FAIL (${run.durationMs}ms)`);
      for (const failure of run.failures) {
        log(`  - ${failure}`);
      }
    }
    log("");
  }

  const passed = results.filter((r) => r.pass).length;
  const total = results.length;
  const passRate = total > 0 ? (passed / total) * 100 : 0;

  log("=== Summary ===");
  log(`Passed: ${passed}/${total} (${passRate.toFixed(1)}%)`);
  log(`${passed}/${total} probes passed (${options.mode} mode)`);
  log(`Threshold: 9/12 (75%) — ${passed >= 9 ? "MET" : "NOT MET"}`);

  if (storage != null && "close" in storage && typeof storage.close === "function") {
    await storage.close();
  }
  if (instance.mastra.shutdown) {
    await instance.mastra.shutdown();
  }
  await db.sql.end();
  await readerDb.sql.end();
  await container.stop();

  await writeArtifact(lines);

  const exitCode = passed < 9 ? 1 : 0;
  return {
    passed,
    total,
    exitCode,
    mode: options.mode,
    lines,
  };
}

async function main(): Promise<void> {
  const { mode } = parseEvalArgv(process.argv.slice(2));
  const result = await runDogfoodEval({ mode });
  if (result.exitCode !== 0) {
    process.exitCode = result.exitCode;
  }
}

async function writeArtifact(lines: string[]): Promise<void> {
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(dirname(ARTIFACT_PATH), { recursive: true });
  await writeFile(ARTIFACT_PATH, `${lines.join("\n")}\n`, "utf8");
}

main().catch(async (err) => {
  console.error(err);
  process.exitCode = 1;
});
