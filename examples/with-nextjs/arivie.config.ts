/* SPDX-License-Identifier: Apache-2.0 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { anthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { defineAgent, defineArivie, type ArivieApp, type ArivieAppConfig } from "@arivie/core";
import { analytics } from "@arivie/plugin-analytics";
import { postgresRuntime, postgresSource } from "@arivie/plugin-postgres";
import { resolveMixpanelSource } from "./lib/mixpanel-source.js";
import type { LanguageModel } from "ai";
import { MockLanguageModelV3 } from "ai/test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const semanticPath = join(__dirname, "semantic");

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (url == null || url.length === 0) throw new Error("DATABASE_URL is required");
  return url;
}

function resolveModel(): LanguageModel {
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY })(process.env.GOOGLE_MODEL ?? "gemini-2.5-flash") as LanguageModel;
  }
  if (process.env.ANTHROPIC_API_KEY) return anthropic("claude-sonnet-4-20250514");
  if (process.env.OPENAI_API_KEY) {
    return createOpenAI({ apiKey: process.env.OPENAI_API_KEY })(process.env.OPENAI_MODEL ?? "gpt-5") as LanguageModel;
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

let cached: { arivie: ArivieApp } | undefined;

export async function getArivieRuntime(): Promise<{ arivie: ArivieApp }> {
  if (cached == null) {
    const databaseUrl = requireDatabaseUrl();
    const ownerId = process.env.ARIVIE_OWNER_ID ?? "with-nextjs-owner";
    const { adapter: mixpanel, label } = resolveMixpanelSource();
    if (label.includes("mock-plan-b")) console.warn(`[with-nextjs] ${label}`);
    const config: ArivieAppConfig = {
      app: { id: ownerId, name: "With Next.js Example" },
      model: resolveModel(),
      storage: postgresRuntime({ url: databaseUrl }),
      plugins: [
        analytics({
          semanticPath,
          mode: "preload",
          sources: {
            postgres: postgresSource({ url: databaseUrl, readOnlyRole: "arivie_reader" }),
            mixpanel,
          },
          compileMetric: true,
          ownerId,
        }),
      ],
      agents: {
        analyst: defineAgent({
          instructions: "Answer analytics questions for the Next.js example across Postgres and Mixpanel.",
          capabilities: ["analytics.query", "analytics.compile_metric"],
        }),
      },
      resolveUser: async () => ({
        userId: "demo-user",
        permissions: ["analytics:read"],
        dbRole: "arivie_reader",
      }),
    };
    cached = { arivie: await defineArivie(config) };
  }
  return cached;
}
