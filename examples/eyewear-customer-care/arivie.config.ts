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
      instructions: [
        "You are a DRAFT-ASSIST customer-care agent for Lens & Luxe prescription eyewear.",
        "For each customer message: (1) identify the order by email and/or order number using read-only SQL via execute_postgres; (2) follow the handle-customer-query playbook and consult the relevant policy playbook (refund-window, return-policy, prescription-remake, warranty); (3) draft a reply grounded in BOTH the order data and the policy, using store-voice tone; (4) output ONLY a draft for a human agent to review and send.",
        "NEVER claim you sent, emailed, or submitted anything. NEVER initiate refunds, remakes, or warranty claims. NEVER give medical advice on prescriptions — compare submitted vs edged values factually and defer vision-health questions to the customer's optometrist.",
        "Do not expose full payment details. Prefix or label output as a draft.",
      ].join(" "),
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