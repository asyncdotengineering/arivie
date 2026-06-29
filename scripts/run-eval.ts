/* SPDX-License-Identifier: Apache-2.0 */
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { InMemoryStore } from "@mastra/core/storage";
import { RequestContext } from "@mastra/core/di";
import { parse as parseYaml } from "yaml";
import {
  defineAgent,
  defineArivie,
  InMemoryRuntimeStorage,
} from "@arivie/core";
import {
  createDogfoodScorer,
  type ValidationRule,
} from "@arivie/core/eval";
import { analytics } from "../packages/plugin-analytics/src/index.js";
import { createEvalAdapters } from "./eval-adapters.js";
import {
  createEvalMockModel,
  type EvalPromptMeasurement,
} from "./eval-mock-model.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARIVIE_ROOT = join(__dirname, "..");
const PROBES_DIR = join(ARIVIE_ROOT, "evals", "golden-queries");
const SEMANTIC_DIR = join(ARIVIE_ROOT, "evals", "semantic");
const BASELINE_PATH = join(ARIVIE_ROOT, "evals", "baseline.json");
const SEED_SQL = join(__dirname, "seed-dogfood.sql");

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
  input_tokens: number;
  agent_sql: string | null;
}

interface EvalReport {
  ref: string;
  mode: "preload" | "navigation";
  model: "eval-mock";
  token_estimator: "ceil(chars/4)";
  passed: number;
  total: number;
  accuracy: number;
  mean_input_tokens: number;
  per_probe: ProbeRun[];
}

interface BaselineReport extends EvalReport {
  comment: string;
  mode: "preload";
}

async function loadProbes(): Promise<Probe[]> {
  const files = (await readdir(PROBES_DIR))
    .filter((name) => name.endsWith(".yml"))
    .sort();
  return Promise.all(
    files.map(async (file) => {
      const raw = await readFile(join(PROBES_DIR, file), "utf8");
      return parseYaml(raw) as Probe;
    }),
  );
}

function scorerOutput(sqlCalls: string[], answer: string): unknown[] {
  return [
    {
      content: {
        parts: [
          ...sqlCalls.map((sql, index) => ({
            type: "tool-invocation",
            toolInvocation: {
              toolCallId: `eval-${index + 1}`,
              toolName: "execute",
              args: { sql },
            },
          })),
          { type: "text", text: answer },
        ],
      },
    },
  ];
}

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return Number(
    (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2),
  );
}

async function runNavigationEval(probes: Probe[]): Promise<EvalReport> {
  const promptMeasurements = new Map<string, EvalPromptMeasurement>();
  const model = createEvalMockModel(probes, {
    toolName: "execute_orders",
    onPrompt: (measurement) => {
      promptMeasurements.set(measurement.probeId, measurement);
    },
  });
  const { db, readerDb, cleanup } = await createEvalAdapters();
  let app: Awaited<ReturnType<typeof defineArivie>> | undefined;

  try {
    await db.setupRole("arivie_reader");
    await db.sql.unsafe(
      `ALTER ROLE arivie_reader WITH LOGIN PASSWORD 'test-arivie-reader'`,
    );
    await db.sql.unsafe(await readFile(SEED_SQL, "utf8"));
    await db.sql`
      INSERT INTO arivie_owner_identity (key, value)
      VALUES ('owner_id', 'dogfood-owner')
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `;
    await db.sql.unsafe(`GRANT SELECT ON TABLE orders TO arivie_reader`);

    app = await defineArivie({
      app: { id: "dogfood-owner", name: "Dogfood" },
      model,
      storage: new InMemoryRuntimeStorage(),
      memory: new InMemoryStore(),
      plugins: [
        analytics({
          semanticPath: SEMANTIC_DIR,
          sources: { orders: db },
        }),
      ],
      agents: {
        analyst: defineAgent({
          instructions: "Answer with concise, SQL-backed evidence.",
          capabilities: ["analytics.query"],
        }),
      },
      resolveUser: async () => ({
        userId: "eval-user",
        permissions: ["analytics.sql.read", "database.read"],
        dbRole: "arivie_reader",
      }),
    });

    async function executeSql(
      sql: string,
    ): Promise<Record<string, unknown>[]> {
      const executed = await readerDb.execute({
        query: sql,
        runAsRole: "arivie_reader",
        userId: "eval-user",
        rowLimit: 500,
        timeoutMs: 30_000,
      });
      return executed.rows;
    }

    const scorer = createDogfoodScorer({ executeSql });
    const runs: ProbeRun[] = [];

    for (const probe of probes) {
      const sqlCalls: string[] = [];
      const answer = await app.prompt({
        agent: "analyst",
        prompt: probe.question,
        session: { id: `eval-${probe.id}`, resource: "eval-user" },
        user: {
          userId: "eval-user",
          permissions: ["analytics.sql.read", "database.read"],
          dbRole: "arivie_reader",
        },
        onTool: (_tool, args) => {
          if (typeof args.sql === "string") {
            sqlCalls.push(args.sql);
          }
        },
      });

      const requestContext = new RequestContext();
      requestContext.set("probe", probe);
      const score = await scorer.run({
        input: probe.question,
        output: scorerOutput(sqlCalls, answer),
        groundTruth: probe.golden_sql.trim(),
        requestContext,
      });
      const measurement = promptMeasurements.get(probe.id);
      if (measurement === undefined) {
        throw new Error(`No input-token measurement recorded for ${probe.id}`);
      }

      const run: ProbeRun = {
        id: probe.id,
        category: probe.category,
        pass: score.score === 1,
        input_tokens: measurement.inputTokens,
        agent_sql: sqlCalls.at(-1) ?? null,
      };
      runs.push(run);
      console.log(
        `${run.pass ? "PASS" : "FAIL"} ${run.id} (${run.input_tokens} input tokens)`,
      );
    }

    const passed = runs.filter((run) => run.pass).length;
    return {
      ref: "working-tree",
      mode: "navigation",
      model: "eval-mock",
      token_estimator: "ceil(chars/4)",
      passed,
      total: runs.length,
      accuracy: runs.length === 0 ? 0 : passed / runs.length,
      mean_input_tokens: mean(runs.map((run) => run.input_tokens)),
      per_probe: runs,
    };
  } finally {
    if (app !== undefined) {
      await app.dispose();
    } else {
      await cleanup();
    }
  }
}

async function loadBaseline(): Promise<BaselineReport> {
  const baseline = JSON.parse(
    await readFile(BASELINE_PATH, "utf8"),
  ) as BaselineReport;
  if (
    baseline.ref !== "f0084fb" ||
    baseline.mode !== "preload" ||
    baseline.model !== "eval-mock" ||
    baseline.total !== 12
  ) {
    throw new Error("evals/baseline.json is not the C9 preload baseline");
  }
  return baseline;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function printComparison(
  baseline: BaselineReport,
  navigation: EvalReport,
): void {
  const accuracyDelta = navigation.accuracy - baseline.accuracy;
  const tokenDelta =
    navigation.mean_input_tokens - baseline.mean_input_tokens;

  console.log("");
  console.log("=== Navigation vs recorded preload baseline ===");
  console.log(
    "Metric              | Preload baseline | Navigation | Delta",
  );
  console.log(
    `Accuracy            | ${percent(baseline.accuracy).padStart(16)} | ${percent(navigation.accuracy).padStart(10)} | ${percent(accuracyDelta).padStart(7)}`,
  );
  console.log(
    `Mean input tokens    | ${baseline.mean_input_tokens.toFixed(2).padStart(16)} | ${navigation.mean_input_tokens.toFixed(2).padStart(10)} | ${tokenDelta.toFixed(2).padStart(7)}`,
  );
}

function warnIgnoredLegacyMode(argv: string[]): void {
  if (argv.some((arg) => arg === "--mode" || arg.startsWith("--mode="))) {
    console.warn(
      "[arivie eval] --mode is ignored; the C9 gate always evaluates navigation",
    );
  }
}

export function gatePasses(
  baseline: Pick<EvalReport, "accuracy" | "mean_input_tokens">,
  navigation: Pick<EvalReport, "accuracy" | "mean_input_tokens">,
): boolean {
  return (
    navigation.accuracy >= baseline.accuracy &&
    navigation.mean_input_tokens < baseline.mean_input_tokens
  );
}

export async function runGate(): Promise<number> {
  warnIgnoredLegacyMode(process.argv.slice(2));
  const probes = await loadProbes();
  const baseline = await loadBaseline();
  const navigation = await runNavigationEval(probes);
  printComparison(baseline, navigation);

  const accuracyPass = navigation.accuracy >= baseline.accuracy;
  const tokenPass =
    navigation.mean_input_tokens < baseline.mean_input_tokens;
  console.log("");
  console.log(`Accuracy gate: ${accuracyPass ? "PASS" : "FAIL"}`);
  console.log(`Token gate: ${tokenPass ? "PASS" : "FAIL"}`);
  return gatePasses(baseline, navigation) ? 0 : 1;
}

const entryPath = process.argv[1];
if (
  entryPath !== undefined &&
  import.meta.url === pathToFileURL(entryPath).href
) {
  runGate()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
