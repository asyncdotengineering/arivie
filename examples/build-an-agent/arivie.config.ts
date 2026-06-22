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
  if (url == null || url === "") throw new Error("DATABASE_URL is required");
  return url;
}

function resolveModel() {
  const key = process.env.OPENAI_API_KEY;
  if (key == null || key === "") throw new Error("OPENAI_API_KEY is required");
  return createOpenAI({ apiKey: key })(process.env.OPENAI_MODEL ?? "gpt-4o-mini");
}

const databaseUrl = requireDatabaseUrl();

export const config: ArivieAppConfig = {
  app: { id: "northwind", name: "Northwind Analytics" },
  model: resolveModel(),
  // Durable runtime: sessions, runs, and a cursor-replayable event log.
  storage: postgresRuntime({ url: databaseUrl }),
  plugins: [
    // Analytics is a plugin. It contributes the read-only SQL tools, the
    // semantic layer, and metric compilation.
    analytics({
      semanticPath,
      mode: "preload",
      compileMetric: true,
      sources: {
        // The agent's SQL runs as `arivie_reader` — read-only by construction.
        postgres: postgresSource({ url: databaseUrl, readOnlyRole: "arivie_reader" }),
      },
    }),
  ],
  agents: {
    analyst: defineAgent({
      instructions:
        "You are a senior data analyst for Northwind. Answer questions about the team's data with exact, SQL-backed numbers. " +
        "State the assumptions behind any number (date range, filters, grain). Prefer the declared measures over hand-rolled SQL. " +
        "If you cannot answer from the data, say so plainly.",
      capabilities: ["analytics.query", "analytics.compile_metric"],
    }),
  },
  // No `context` layer here — this analytics example's knowledge lives in the
  // semantic layer (entities + glossary.yml), loaded by the analytics plugin.
  // The context layer is for prose knowledge pages (see examples/support-agent).
  resolveUser: async () => ({
    userId: "analyst",
    permissions: ["analytics:read"],
    dbRole: "arivie_reader",
  }),
};

export default config;
export const arivie = await defineArivie(config);
