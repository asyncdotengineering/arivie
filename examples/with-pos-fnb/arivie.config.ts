/* SPDX-License-Identifier: Apache-2.0 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createOpenAI } from "@ai-sdk/openai";
import { defineAgent, defineArivie, defineSchedules, type ArivieAppConfig } from "@arivie/core";
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

export const schedules = defineSchedules([
  {
    id: "daily-sales-recap",
    cron: "0 2 * * *",
    timezone: "America/Chicago",
    prompt:
      "Run the daily-sales-recap skill for yesterday. Flag comp/void breaches and write a Markdown brief.",
    metadata: { audience: "general-manager", cadence: "daily" },
  },
  {
    id: "weekly-flash-report",
    cron: "0 8 * * 1",
    timezone: "America/Chicago",
    prompt:
      "Run the weekly-flash-report skill for last week. Compare WoW revenue, prime cost, and KPIs.",
    metadata: { audience: "general-manager", cadence: "weekly" },
  },
  {
    id: "prime-cost-recap",
    cron: "0 7 * * 1",
    timezone: "America/Chicago",
    prompt:
      "Run the prime-cost-recap skill for last week. Focus on food + labor as % of revenue by outlet.",
    metadata: { audience: "owner", cadence: "weekly" },
  },
]);

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
  resolveUser: async () => ({
    userId: "arivie-mcp",
    permissions: ["analytics:read"],
    dbRole: "arivie_reader",
  }),
};

export default config;
export const arivie = await defineArivie(config);
