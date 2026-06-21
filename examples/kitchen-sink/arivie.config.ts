/* SPDX-License-Identifier: Apache-2.0 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createOpenAI } from "@ai-sdk/openai";
import { defineAgent, defineArivie, defineSchedules, type ArivieAppConfig } from "@arivie/core";
import { analytics } from "@arivie/plugin-analytics";
import { postgresRuntime, postgresSource } from "@arivie/plugin-postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));
const semanticPath = join(__dirname, "semantic");

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value == null || value.length === 0) {
    throw new Error(`${name} is required for the kitchen-sink example`);
  }
  return value;
}

const databaseUrl = requireEnv("DATABASE_URL");
const openai = createOpenAI({ apiKey: requireEnv("OPENAI_API_KEY") });

export const schedules = defineSchedules([
  {
    id: "daily-ops-brief",
    cron: "0 9 * * *",
    timezone: "America/Chicago",
    prompt:
      "Run the daily-ops-brief skill for yesterday. Flag comp/void breaches and write a Markdown brief.",
    metadata: { audience: "general-manager", cadence: "daily" },
  },
  {
    id: "monday-margin-watch",
    cron: "0 8 * * 1",
    timezone: "America/Chicago",
    prompt:
      "Run the margin-watch skill for the last 7 days. Focus on outlet variance and menu margin leakage.",
    metadata: { audience: "owner", cadence: "weekly" },
  },
]);

export const config: ArivieAppConfig = {
  app: {
    id: process.env.ARIVIE_OWNER_ID ?? "northstar-hospitality",
    name: "Northstar Hospitality",
  },
  model: openai(process.env.OPENAI_MODEL ?? "gpt-4o-mini"),
  storage: postgresRuntime({ url: databaseUrl }),
  plugins: [
    analytics({
      semanticPath,
      mode: "preload",
      sources: {
        postgres: postgresSource({
          url: databaseUrl,
          readOnlyRole: "arivie_reader",
        }),
      },
      compileMetric: true,
      ownerId: process.env.ARIVIE_OWNER_ID ?? "northstar-hospitality",
    }),
  ],
  agents: {
    analyst: defineAgent({
      instructions:
        "You are an operations analyst for Northstar Hospitality. Answer with concise, auditable SQL-backed analysis.",
      capabilities: ["analytics.query", "analytics.compile_metric"],
    }),
  },
  context: { root: semanticPath },
  resolveUser: async () => ({
    userId: "northstar-gm",
    permissions: ["analytics:read", "ops:read"],
    dbRole: "arivie_reader",
  }),
};

export const arivie = await defineArivie(config);

export default arivie;
