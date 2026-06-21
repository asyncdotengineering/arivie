/* SPDX-License-Identifier: Apache-2.0 */
import { anthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { defineAgent, defineArivie, type ArivieApp, type ArivieAppConfig } from "@arivie/core";
import { analytics } from "@arivie/plugin-analytics";
import { postgresRuntime, postgresSource } from "@arivie/plugin-postgres";
import type { LanguageModel } from "ai";
import { MockLanguageModelV3 } from "ai/test";

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
  if (env.DATABASE_URL.length === 0) throw new Error("DATABASE_URL binding is required");
  return env.DATABASE_URL;
}

function resolveModel(env: ArivieWorkerEnv): LanguageModel {
  if (env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return createGoogleGenerativeAI({ apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY })(env.GOOGLE_MODEL ?? "gemini-2.5-flash") as LanguageModel;
  }
  if (env.ANTHROPIC_API_KEY) return anthropic("claude-sonnet-4-20250514");
  if (env.OPENAI_API_KEY) {
    return createOpenAI({ apiKey: env.OPENAI_API_KEY })(env.OPENAI_MODEL ?? "gpt-5") as LanguageModel;
  }
  return new MockLanguageModelV3({
    provider: "mock",
    modelId: "mock",
    doGenerate: {
      content: [{ type: "text", text: "Example mock response." }],
      finishReason: "stop",
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      warnings: [],
    },
  } as unknown as ConstructorParameters<typeof MockLanguageModelV3>[0]) as LanguageModel;
}

const runtimeByEnv = new WeakMap<ArivieWorkerEnv, { arivie: ArivieApp }>();

export async function getArivieRuntime(env: ArivieWorkerEnv): Promise<{ arivie: ArivieApp }> {
  let cached = runtimeByEnv.get(env);
  if (cached == null) {
    const databaseUrl = requireDatabaseUrl(env);
    const ownerId = env.ARIVIE_OWNER_ID ?? "with-cloudflare-do-owner";
    const config: ArivieAppConfig = {
      app: { id: ownerId, name: "With Cloudflare DO Example" },
      model: resolveModel(env),
      storage: postgresRuntime({ url: databaseUrl }),
      plugins: [
        analytics({
          semanticPath: "./semantic",
          mode: "preload",
          sources: {
            postgres: postgresSource({ url: databaseUrl, readOnlyRole: "arivie_reader" }),
          },
        }),
      ],
      agents: {
        analyst: defineAgent({
          instructions: "Answer analytics questions for the Cloudflare Durable Object example.",
          capabilities: ["analytics.query"],
        }),
      },
      context: { root: "./semantic" },
      resolveUser: async () => ({
        userId: "demo-user",
        permissions: ["analytics:read"],
        dbRole: "arivie_reader",
      }),
    };
    cached = { arivie: await defineArivie(config) };
    runtimeByEnv.set(env, cached);
  }
  return cached;
}
