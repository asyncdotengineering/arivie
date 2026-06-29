/* SPDX-License-Identifier: Apache-2.0 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createOpenAI } from "@ai-sdk/openai";
import { defineAgent, defineArivie, type ArivieAppConfig } from "@arivie/core";
import { analytics } from "@arivie/plugin-analytics";
import { postgresRuntime, postgresSource } from "@arivie/plugin-postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));
const semanticPath = join(__dirname, "semantic");
const knowledgePath = join(__dirname, "knowledge");

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (url == null || url === "") throw new Error("DATABASE_URL is required for arivie.config.ts");
  return url;
}

function resolveModel() {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey == null || openaiKey === "") throw new Error("OPENAI_API_KEY is required for arivie.config.ts");
  return createOpenAI({ apiKey: openaiKey })(process.env.OPENAI_MODEL ?? "gpt-4o-mini");
}

const databaseUrl = requireDatabaseUrl();

const config: ArivieAppConfig = {
  app: {
    id: process.env.ARIVIE_OWNER_ID ?? "lens-luxe-care",
    name: "Lens & Luxe Customer Care",
  },
  model: resolveModel(),
  context: { root: knowledgePath },
  storage: postgresRuntime({ url: databaseUrl }),
  plugins: [
    analytics({
      semanticPath,
      sources: {
        postgres: postgresSource({ url: databaseUrl, readOnlyRole: "arivie_reader" }),
      },
    }),
  ],
  agents: {
    care: defineAgent({
      instructions:
        "You are a customer-care draft-assist agent for a prescription eyewear DTC brand. Look up orders, prescriptions, refunds, and remake requests with read-only SQL. Draft empathetic reply suggestions for support agents — never send messages, never initiate refunds or remakes, and never expose full payment details.",
      capabilities: ["analytics.query"],
    }),
  },
  resolveUser: async () => ({
    userId: "care-agent",
    permissions: ["analytics:read"],
    dbRole: "arivie_reader",
  }),
};

export default config;
export const arivie = await defineArivie(config);