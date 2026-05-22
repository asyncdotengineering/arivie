/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Live dogfood smoke (v02-S2-06 / C54): `defineArivie` with a sandboxed workspace
 * against seeded Postgres + Gemini.
 *
 * - Reads `DATABASE_URL` and `GOOGLE_GENERATIVE_AI_API_KEY` from `.env.local`.
 * - Model: same resolution order as `arivie.config.ts` (Gemini 2.5 Flash default).
 * - Filesystem: `VercelSandboxFilesystem` when `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, and
 *   `VERCEL_PROJECT_ID` are set; otherwise `InProcessSandboxFilesystem` (documented
 *   HS-3 deviation — no Vercel creds).
 * - Semantic mode: `indexed` (workspace navigation + `finalize_report`).
 * - Uploads dogfood semantic layer + six skills from `@arivie/skills` package dir.
 *
 * Usage (from `arivie/examples/with-nextjs`):
 *   pnpm exec tsx scripts/sandboxed-workspace-smoke.ts
 */
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { anthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { defineArivie, type ArivieInstance } from "@arivie/core";
import { runWithUserContext } from "@arivie/core/context";
import { postgresAdapter } from "@arivie/db-postgres";
import type { EmbeddingProvider } from "@arivie/embeddings";
import {
  InProcessSandboxFilesystem,
  VercelSandboxFilesystem,
  resolveVercelSandboxCredentials,
} from "@arivie/workspace";
import type { LanguageModel } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { PgVector } from "@mastra/pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "..", ".env.local");
const semanticPath = join(__dirname, "..", "semantic");
const skillsPath = join(__dirname, "..", "..", "..", "packages", "skills");

const RAG_INDEX_NAME = "with_nextjs_sem_5";
const GOOGLE_EMBED_MODEL = "gemini-embedding-001";
const GOOGLE_EMBED_DIMENSIONS = 768;

const QUESTIONS = [
  "What is our revenue this quarter?",
  "Show me cohort retention for the last 3 months.",
] as const;

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
    console.warn(`[c54-smoke] could not read ${envPath}: ${String(err)}`);
  }
}

/** Mirrors `arivie.config.ts` — do not hard-code gemini-3.1-flash-lite. */
function resolveModel(): { model: LanguageModel; modelId: string } {
  const googleKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (googleKey != null && googleKey.length > 0) {
    const google = createGoogleGenerativeAI({ apiKey: googleKey });
    const modelId = process.env.GOOGLE_MODEL ?? "gemini-2.5-flash";
    return { model: google(modelId) as LanguageModel, modelId };
  }
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey != null && anthropicKey.length > 0) {
    return { model: anthropic("claude-sonnet-4-20250514"), modelId: "claude-sonnet-4-20250514" };
  }
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey != null && openaiKey.length > 0) {
    const openai = createOpenAI({ apiKey: openaiKey });
    const modelId = process.env.OPENAI_MODEL ?? "gpt-5";
    return { model: openai(modelId) as LanguageModel, modelId };
  }
  console.warn(
    "[c54-smoke] No model API key — using mock (set GOOGLE_GENERATIVE_AI_API_KEY for live run)",
  );
  return {
    model: new MockLanguageModelV3({
      provider: "mock",
      modelId: "mock",
      doGenerate: {
        content: [{ type: "text", text: "mock" }],
        finishReason: "stop",
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        warnings: [],
      },
    } as unknown as ConstructorParameters<typeof MockLanguageModelV3>[0]) as LanguageModel,
    modelId: "mock",
  };
}

function makeGoogleEmbeddingProvider(): EmbeddingProvider {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (apiKey == null || apiKey === "") {
    throw new Error("GOOGLE_GENERATIVE_AI_API_KEY required for indexed mode");
  }
  const google = createGoogleGenerativeAI({ apiKey });
  return {
    model: google.textEmbedding(GOOGLE_EMBED_MODEL),
    modelName: GOOGLE_EMBED_MODEL,
    dimensions: GOOGLE_EMBED_DIMENSIONS,
    costPerMillionTokens: 0.15,
    providerOptions: {
      google: { outputDimensionality: GOOGLE_EMBED_DIMENSIONS },
    },
  };
}

interface ToolCallRecord {
  readonly toolName: string;
  readonly input: unknown;
  readonly output: unknown;
}

interface QuestionRun {
  readonly question: string;
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
        console.log(`── tool-call: ${String(p.toolName ?? "?")}`);
        console.log(`   input: ${JSON.stringify(p.input ?? p.args ?? {}).slice(0, 800)}`);
      } else if (p.type === "tool-result") {
        const id = String(p.toolCallId ?? "");
        const prev = pending.get(id);
        const toolName = prev?.toolName ?? String(p.toolName ?? "?");
        const output = p.output ?? p.result ?? {};
        toolCalls.push({
          toolName,
          input: prev?.input ?? {},
          output,
        });
        const outStr =
          typeof output === "object" && output !== null && "value" in output
            ? String((output as { value: unknown }).value)
            : JSON.stringify(output);
        console.log(`── tool-result: ${toolName}`);
        console.log(`   output: ${outStr.slice(0, 800)}`);
      }
    }
  }
  return toolCalls;
}

function countByPredicate(
  toolCalls: ToolCallRecord[],
  pred: (name: string) => boolean,
): number {
  return toolCalls.filter((c) => pred(c.toolName)).length;
}

/** When `stopWhen` fires on `finalize_report`, Mastra may leave `result.text` empty. */
function effectiveAnswer(run: QuestionRun): string {
  if (run.text.trim() !== "") {
    return run.text.trim();
  }
  for (const call of run.toolCalls) {
    if (call.toolName !== "finalize_report") continue;
    const input = call.input as { narrative?: unknown };
    if (typeof input.narrative === "string" && input.narrative.trim() !== "") {
      return input.narrative.trim();
    }
    const output = call.output as { narrative?: unknown };
    if (typeof output.narrative === "string" && output.narrative.trim() !== "") {
      return output.narrative.trim();
    }
  }
  return "";
}

function assertQuestionRun(run: QuestionRun, index: number): string[] {
  const failures: string[] = [];
  const label = `Q${index + 1}`;

  if (run.error != null) {
    failures.push(`${label}: agent threw: ${run.error}`);
    return failures;
  }

  const answer = effectiveAnswer(run);
  if (answer === "") {
    failures.push(`${label}: empty answer (text + finalize_report narrative)`);
  }

  const finalizeCount = countByPredicate(
    run.toolCalls,
    (n) => n === "finalize_report",
  );
  if (finalizeCount < 1) {
    failures.push(`${label}: finalize_report not called (count=${finalizeCount})`);
  }

  const workspaceCount = countByPredicate(run.toolCalls, (n) =>
    n.startsWith("mastra_workspace_"),
  );
  if (workspaceCount < 1) {
    failures.push(`${label}: mastra_workspace_* not called (count=${workspaceCount})`);
  }

  const postgresCount = countByPredicate(
    run.toolCalls,
    (n) => n === "execute_postgres",
  );
  if (postgresCount < 1) {
    failures.push(`${label}: execute_postgres not called (count=${postgresCount})`);
  }

  return failures;
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
      label: "VercelSandboxFilesystem (live creds)",
    };
  }

  const sandboxRoot = await mkdtemp(join(tmpdir(), "arivie-c54-sbx-"));
  console.log(
    "[c54-smoke] HS-3: Vercel creds absent — using InProcessSandboxFilesystem",
  );
  console.log(`[c54-smoke] sandbox root: ${sandboxRoot}`);
  return {
    filesystem: new InProcessSandboxFilesystem({ rootDir: sandboxRoot }),
    label: "InProcessSandboxFilesystem (VERCEL_* creds absent)",
    cleanup: async () => {
      await rm(sandboxRoot, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}

async function runQuestion(
  instance: ArivieInstance,
  user: { userId: string; permissions: string[]; dbRole: string },
  question: string,
): Promise<QuestionRun> {
  const t0 = Date.now();
  console.log(`\n══════════════════════════════════════════════════════════`);
  console.log(`→ question: ${question}\n`);
  try {
    const result = (await runWithUserContext(user, async () =>
      instance.agent.generate(question),
    )) as Record<string, unknown>;
    const text = typeof result.text === "string" ? result.text : "";
    const response = result.response as { messages?: unknown[] } | undefined;
    const messages = Array.isArray(response?.messages) ? response.messages : [];
    const toolCalls = collectToolCalls(messages);
    const run: QuestionRun = { question, text, toolCalls, durationMs: Date.now() - t0 };
    const answer = effectiveAnswer(run);
    console.log(`\n── answer:\n${answer || "(empty)"}\n`);
    return run;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[c54-smoke] ERROR: ${message}`);
    return {
      question,
      text: "",
      toolCalls: [],
      durationMs: Date.now() - t0,
      error: message,
    };
  }
}

function formatToolCounts(run: QuestionRun): string {
  const names = run.toolCalls.map((c) => c.toolName);
  const unique = [...new Set(names)].sort();
  const lines = unique.map((name) => {
    const n = names.filter((x) => x === name).length;
    return `  ${name}: ${n}`;
  });
  return lines.join("\n");
}

async function main(): Promise<void> {
  loadEnv();

  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (apiKey == null || apiKey === "") {
    console.error("[c54-smoke] GOOGLE_GENERATIVE_AI_API_KEY not set — need .env.local");
    process.exit(2);
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl == null || databaseUrl === "") {
    console.error("[c54-smoke] DATABASE_URL not set");
    process.exit(2);
  }

  const { model, modelId } = resolveModel();
  const { filesystem, label: fsLabel, cleanup } = await resolveFilesystem();

  console.log("══════════════════════════════════════════════════════════");
  console.log("c54 sandboxed-workspace live smoke");
  console.log(`model:      ${modelId}`);
  console.log(`filesystem: ${fsLabel}`);
  console.log(`semantic:   ${semanticPath} (mode=indexed)`);
  console.log(`skills:     ${skillsPath}`);
  console.log("══════════════════════════════════════════════════════════\n");

  const postgres = postgresAdapter({
    url: databaseUrl,
    readOnlyRole: "arivie_reader",
  });
  const user = {
    userId: "c54-smoke-cli",
    permissions: ["analytics:read"],
    dbRole: "arivie_reader",
  };

  const embeddings = {
    provider: makeGoogleEmbeddingProvider(),
    vector: new PgVector({
      id: "with-nextjs-pgvector-c54",
      connectionString: databaseUrl,
    }),
    indexName: RAG_INDEX_NAME,
  };

  let instance: ArivieInstance | undefined;
  try {
    instance = await defineArivie({
      owner: {
        id: process.env.ARIVIE_OWNER_ID ?? "with-nextjs-owner",
        name: "C54 sandboxed smoke",
      },
      
      model,
      workspace: {
        filesystem,
        finalizeReport: true,
        skills: skillsPath,
      },
      sources: {
        postgres: {
          adapter: postgres,
          description: "Demo Postgres for this example script.",
        },
      },
      semantic: {
        path: semanticPath,
        mode: "indexed",
        embeddings,
      },
      compileMetric: true,
      resolveUser: async () => user,
    });

    const runs: QuestionRun[] = [];
    for (const question of QUESTIONS) {
      runs.push(await runQuestion(instance, user, question));
    }

    const failures: string[] = [];
    const countLines: string[] = [
      "c54-tool-call-counts",
      `model: ${modelId}`,
      `filesystem: ${fsLabel}`,
      "",
    ];

    for (let i = 0; i < runs.length; i++) {
      const run = runs[i]!;
      countLines.push(`--- ${run.question} ---`);
      countLines.push(formatToolCounts(run));
      countLines.push(
        `finalize_report: ${countByPredicate(run.toolCalls, (n) => n === "finalize_report")}`,
      );
      countLines.push(
        `mastra_workspace_*: ${countByPredicate(run.toolCalls, (n) => n.startsWith("mastra_workspace_"))}`,
      );
      countLines.push(
        `execute_postgres: ${countByPredicate(run.toolCalls, (n) => n === "execute_postgres")}`,
      );
      countLines.push(`answer_nonempty: ${effectiveAnswer(run).length > 0}`);
      countLines.push(`duration_ms: ${run.durationMs}`);
      countLines.push("");
      failures.push(...assertQuestionRun(run, i));
    }

    console.log("\n── assertion summary ──");
    if (failures.length === 0) {
      console.log("PASS — all questions satisfied AC");
      console.log("\n── tool-call counts (artifact body) ──");
      console.log(countLines.join("\n"));
      process.exitCode = 0;
    } else {
      for (const f of failures) {
        console.error(`FAIL: ${f}`);
      }
      console.log("\n── tool-call counts (artifact body) ──");
      console.log(countLines.join("\n"));
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
    await embeddings.vector.disconnect?.();
    if (cleanup != null) {
      await cleanup();
    }
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`\n[c54-smoke] FATAL: ${message}`);
  if (err instanceof Error && err.stack != null) {
    console.error(err.stack);
  }
  process.exit(1);
});
