/* SPDX-License-Identifier: Apache-2.0 */
import { defineArivie, type ArivieInstance } from "@arivie/core";
import { postgresAdapter } from "@arivie/db-postgres";
import { makeMcpServer } from "@arivie/mcp";
import type { MCPServer } from "@mastra/mcp";
import { anthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { MockLanguageModelV3 } from "ai/test";
// The semantic layer is inlined at build time by `scripts/inline-semantic.ts`
// because Cloudflare Workers (even with nodejs_compat) do not expose the
// example's `semantic/` YAML files at runtime.
import { semanticLayer } from "./src/semantic-inline";

/** Worker/DO bindings — not process.env. Pass env from the DO `env` argument. */
export interface ArivieWorkerEnv {
  DATABASE_URL: string;
  ARIVIE_OWNER_ID?: string;
  GOOGLE_GENERATIVE_AI_API_KEY?: string;
  GOOGLE_MODEL?: string;
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
}

function requireDatabaseUrl(env: ArivieWorkerEnv): string {
  if (env.DATABASE_URL.length === 0) {
    throw new Error("DATABASE_URL binding is required on the Durable Object");
  }
  return env.DATABASE_URL;
}

function resolveModel(env: ArivieWorkerEnv): LanguageModel {
  const googleKey = env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (googleKey != null && googleKey.length > 0) {
    const google = createGoogleGenerativeAI({ apiKey: googleKey });
    const modelId = env.GOOGLE_MODEL ?? "gemini-2.5-flash";
    return google(modelId) as LanguageModel;
  }
  const anthropicKey = env.ANTHROPIC_API_KEY;
  if (anthropicKey != null && anthropicKey.length > 0) {
    return anthropic("claude-sonnet-4-20250514");
  }
  const openaiKey = env.OPENAI_API_KEY;
  if (openaiKey != null && openaiKey.length > 0) {
    const openai = createOpenAI({ apiKey: openaiKey });
    return openai(env.OPENAI_MODEL ?? "gpt-5") as LanguageModel;
  }
  console.warn(
    "[with-cloudflare-do] No model key on env — using deterministic mock model.",
  );
  return new MockLanguageModelV3({
    provider: "mock",
    modelId: "mock",
    doGenerate: {
      content: [
        {
          type: "text",
          text: "Example mock response (set GOOGLE_GENERATIVE_AI_API_KEY for a live Gemini run).",
        },
      ],
      finishReason: "stop",
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      warnings: [],
    },
  } as unknown as ConstructorParameters<typeof MockLanguageModelV3>[0]) as LanguageModel;
}

const runtimeByEnv = new WeakMap<ArivieWorkerEnv, {
  arivie: ArivieInstance;
  mcp: MCPServer;
}>();

export async function getArivieRuntime(env: ArivieWorkerEnv): Promise<{
  arivie: ArivieInstance;
  mcp: MCPServer;
}> {
  let cached = runtimeByEnv.get(env);
  if (cached == null) {
    const postgres = postgresAdapter({
      url: requireDatabaseUrl(env),
      readOnlyRole: "arivie_reader",
    });
    const ownerId = env.ARIVIE_OWNER_ID ?? "with-cloudflare-do-owner";
    const arivie = await defineArivie({
      owner: { id: ownerId, name: "With Cloudflare DO Example" },
      model: resolveModel(env),
      workspace: { rootDir: "./semantic" },
      sources: {
        postgres: {
          adapter: postgres,
          description: "Demo Postgres reached from a Cloudflare Worker — read-only role enforced via session-scoped query rewriting.",
          useWhen: "any analytics question routed through the Worker runtime",
        },
      },
      // `path` is required by the config schema but unused at runtime when
      // `layer` is set — the Worker runtime can't read disk.
      semantic: { path: "./semantic", layer: semanticLayer, mode: "preload" },
      resolveUser: async () => ({
        userId: "demo-user",
        permissions: ["analytics:read"],
        dbRole: "arivie_reader",
      }),
    });
    const mcp = makeMcpServer({
      agent: arivie.agent,
      semantic: semanticLayer,
      db: postgres,
      ownerId,
      ownerName: "With Cloudflare DO Example",
    });
    cached = { arivie, mcp };
    runtimeByEnv.set(env, cached);
  }
  return cached;
}
