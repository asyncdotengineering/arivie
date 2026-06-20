/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Sprint 1 lightweight dogfood eval runner (12 golden-SQL probes).
 * Runs probes through Mastra `runEvals` with a composite scorer that checks
 * SQL semantic equivalence and probe-specific validation rules.
 */
import { execSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { parse as parseYaml } from "yaml";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { runEvals } from "@mastra/core/evals";
import type { LanguageModel } from "ai";
import { postgresAdapter } from "@arivie/db-postgres";
import { runWithUserContext } from "@arivie/core/context";
import { defineArivie } from "@arivie/core";
import {
  createDogfoodScorer,
  extractExecuteSql,
  type ValidationRule,
} from "@arivie/core/eval";
import { createEvalMockModel } from "./eval-mock-model.js";

/**
 * @deprecated Use {@link ArivieEvalMode}.
 */
export type EvalMode = "preload" | "browse" | "rag";

export type ArivieEvalMode = "preload" | "indexed";

const DEPRECATED_MODES: Record<"browse" | "rag", ArivieEvalMode> = {
  browse: "preload",
  rag: "indexed",
};

const EVAL_MODES: readonly string[] = ["preload", "browse", "rag"];

export function parseEvalArgv(argv: string[]): { mode: EvalMode } {
  let mode: EvalMode = "preload";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--mode" || arg === "-m") {
      const next = argv[i + 1];
      if (next != null && EVAL_MODES.includes(next)) {
        mode = next as EvalMode;
        i += 1;
      }
    } else if (arg?.startsWith("--mode=")) {
      const value = arg.slice("--mode=".length);
      if (EVAL_MODES.includes(value)) {
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

function resolveArivieMode(mode: EvalMode): ArivieEvalMode {
  if (mode in DEPRECATED_MODES) {
    const mapped = DEPRECATED_MODES[mode as "browse" | "rag"];
    console.warn(
      `[arivie eval] mode "${mode}" is deprecated; using "${mapped}" instead`,
    );
    return mapped;
  }
  return mode as ArivieEvalMode;
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
  const arivieMode = resolveArivieMode(options.mode);
  log(`Arivie S1 dogfood eval — model: ${label} — mode: ${options.mode}`);
  if (arivieMode !== options.mode) {
    log(`(resolved to Arivie semantic mode: ${arivieMode})`);
  }
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
    semantic: { path: SEMANTIC_DIR, mode: arivieMode },
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

  const user = {
    userId: "eval-user",
    permissions: [] as string[],
    dbRole: "arivie_reader",
  };

  const results: ProbeRun[] = [];
  const startedByProbe = new Map<string, number>();

  async function executeSql(sql: string): Promise<Record<string, unknown>[]> {
    const executed = await readerDb.execute({
      query: sql,
      runAsRole: user.dbRole,
      userId: user.userId,
      rowLimit: 500,
      timeoutMs: 30_000,
    });
    return executed.rows;
  }

  const scorer = createDogfoodScorer({ executeSql });

  const data = probes.map((probe) => {
    startedByProbe.set(probe.id, Date.now());
    return {
      input: probe.question,
      groundTruth: probe.golden_sql.trim(),
      requestContext: { probe } as Record<string, unknown>,
    };
  });

  await runEvals({
    data,
    scorers: [scorer],
    target: instance.agent,
    targetOptions: {
      memory: { thread: "eval-run", resource: user.userId },
    },
    concurrency: 1,
    onItemComplete: ({ item, targetResult, scorerResults }) => {
      const requestContext = item.requestContext as
        | Record<string, unknown>
        | undefined;
      const probe = requestContext?.probe as Probe | undefined;
      const probeId = probe?.id ?? "unknown";
      const category = probe?.category ?? "normal";
      const started = startedByProbe.get(probeId) ?? Date.now();
      const durationMs = Date.now() - started;
      const output = targetResult as unknown as Record<string, unknown>;
      const text = typeof output?.text === "string" ? output.text : "";
      const toolResults = output?.toolResults;
      const steps = output?.steps;
      const agentSql = extractExecuteSql(toolResults, steps);

      const composite = scorerResults["dogfood-composite"] as
        | { score: number; reason?: string }
        | undefined;
      const pass = composite?.score === 1;
      const failures: string[] = [];
      if (!pass) {
        failures.push(
          composite?.reason ?? "dogfood-composite scorer returned 0",
        );
      }

      const run: ProbeRun = {
        id: probeId,
        category,
        pass,
        failures,
        agentSql,
        durationMs,
      };
      results.push(run);

      log(`--- ${run.id} (${run.category}) ---`);
      log(`Q: ${String(item.input)}`);
      if (run.agentSql) {
        log(
          `SQL: ${run.agentSql.slice(0, 200)}${run.agentSql.length > 200 ? "…" : ""}`,
        );
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
    },
  });

  // Sort results in probe order so the summary matches the original order.
  const resultsById = new Map(results.map((r) => [r.id, r]));
  const orderedResults = probes.map((probe) => resultsById.get(probe.id)!);

  const passed = orderedResults.filter((r) => r.pass).length;
  const total = orderedResults.length;
  const passRate = total > 0 ? (passed / total) * 100 : 0;

  log("=== Summary ===");
  log(`Passed: ${passed}/${total} (${passRate.toFixed(1)}%)`);
  log(`${passed}/${total} probes passed (${options.mode} mode)`);
  log(`Threshold: 9/12 (75%) — ${passed >= 9 ? "MET" : "NOT MET"}`);

  if (
    storage != null &&
    "close" in storage &&
    typeof storage.close === "function"
  ) {
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
