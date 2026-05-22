/* SPDX-License-Identifier: Apache-2.0 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineArivie, type ArivieInstance } from "@arivie/core";
import { postgresAdapter } from "@arivie/db-postgres";
import { makeMcpServer } from "@arivie/mcp";
import type { MCPServer } from "@mastra/mcp";
import { loadSemanticLayerSync, type SemanticLayer } from "@arivie/semantic";
import { anthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { MockLanguageModelV3 } from "ai/test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const semanticPath = join(__dirname, "semantic");

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (url == null || url.length === 0) {
    throw new Error(
      "DATABASE_URL is required — copy .env.example to .env and set your Postgres URL",
    );
  }
  return url;
}

function resolveModel(): LanguageModel {
  // Preference order: Gemini (cheapest) → Anthropic → OpenAI → mock.
  // Override the Gemini default via GOOGLE_MODEL (e.g. "gemini-2.5-flash").
  const googleKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (googleKey != null && googleKey.length > 0) {
    const google = createGoogleGenerativeAI({ apiKey: googleKey });
    const modelId = process.env.GOOGLE_MODEL ?? "gemini-2.5-flash";
    return google(modelId) as LanguageModel;
  }
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey != null && anthropicKey.length > 0) {
    return anthropic("claude-sonnet-4-20250514");
  }
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey != null && openaiKey.length > 0) {
    const openai = createOpenAI({ apiKey: openaiKey });
    return openai(process.env.OPENAI_MODEL ?? "gpt-5") as LanguageModel;
  }
  console.warn(
    "[with-authjs] No model key set (GOOGLE_GENERATIVE_AI_API_KEY|ANTHROPIC_API_KEY|OPENAI_API_KEY) — using deterministic mock model.",
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

const runtimeCache = new Map<
  string,
  { arivie: ArivieInstance; mcp: MCPServer }
>();

export async function getArivieRuntimeForOwner(ownerId: string): Promise<{
  arivie: ArivieInstance;
  mcp: MCPServer;
}> {
  let cached = runtimeCache.get(ownerId);
  if (cached == null) {
    const postgres = postgresAdapter({
      url: requireDatabaseUrl(),
      readOnlyRole: "arivie_reader",
    });
    const semantic = loadSemanticLayerSync(semanticPath);
    const arivie = await defineArivie({
      owner: {
        id: ownerId,
        name: "With Auth.js Example",
      },
      model: resolveModel(),
      workspace: { rootDir: semanticPath },
      sources: { postgres },
      semantic: { path: semanticPath, mode: "preload" },
      resolveUser: async () => ({
        userId: "demo-user",
        permissions: ["analytics:read"],
        dbRole: "arivie_reader",
      }),
    });
    const mcp = makeMcpServer({
      agent: arivie.agent,
      semantic,
      db: postgres,
      ownerId,
      ownerName: "With Auth.js Example",
    });
    cached = { arivie, mcp };
    runtimeCache.set(ownerId, cached);
  }
  return cached;
}

export async function getArivieRuntime(): Promise<{
  arivie: ArivieInstance;
  mcp: MCPServer;
}> {
  return getArivieRuntimeForOwner(
    process.env.ARIVIE_OWNER_ID ?? "with-authjs-owner",
  );
}
