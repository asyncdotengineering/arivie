/* SPDX-License-Identifier: Apache-2.0 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createOpenAI } from "@ai-sdk/openai";
import { defineAgent, defineArivie, type ArivieAppConfig } from "@arivie/core";
import { analytics } from "@arivie/plugin-analytics";
import { postgresRuntime, postgresSource } from "@arivie/plugin-postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));
const semanticPath = join(__dirname, "semantic");

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (url == null || url === "") throw new Error("DATABASE_URL is required for arivie.config.ts");
  return url;
}

function resolveModel() {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey == null || openaiKey === "") throw new Error("OPENAI_API_KEY is required for arivie.config.ts");
  return createOpenAI({ apiKey: openaiKey })(process.env.OPENAI_MODEL ?? "gpt-5-mini");
}

const databaseUrl = requireDatabaseUrl();

const config: ArivieAppConfig = {
  app: {
    id: process.env.ARIVIE_OWNER_ID ?? "lumiere-chain",
    name: "Lumiere Chain",
  },
  model: resolveModel(),
  storage: postgresRuntime({ url: databaseUrl }),
  plugins: [
    analytics({
      semanticPath,
      mode: "preload",
      sources: {
        postgres: postgresSource({ url: databaseUrl, readOnlyRole: "arivie_reader" }),
      },
      compileMetric: true,
    }),
  ],
  agents: {
    analyst: defineAgent({
      instructions: "Answer F&B operations questions with concise, SQL-backed evidence.",
      capabilities: ["analytics.query", "analytics.compile_metric"],
    }),
  },
  context: { root: semanticPath },
  resolveUser: async () => ({
    userId: "arivie-mcp",
    permissions: ["analytics:read"],
    dbRole: "arivie_reader",
  }),
};

export default config;
export const arivie = await defineArivie(config);
