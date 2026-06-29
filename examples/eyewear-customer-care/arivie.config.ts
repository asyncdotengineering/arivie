/* SPDX-License-Identifier: Apache-2.0 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import {
  defineAgent,
  defineArivie,
  type ArivieAppConfig,
  type RuntimeStorage,
} from "@arivie/core";
import type { PostgresAdapter } from "@arivie/db-postgres";
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

function resolveModel(): LanguageModel {
  // A draft-assist agent needs a real LLM to compose grounded replies. The
  // config builds even without a key (so `arivie info` / the CLI can inspect it);
  // the model is only invoked at prompt time. Set OPENAI_API_KEY to run.
  const openaiKey = process.env.OPENAI_API_KEY ?? "";
  return createOpenAI({ apiKey: openaiKey })(process.env.OPENAI_MODEL ?? "gpt-4o-mini");
}

/**
 * Build the eyewear customer-care config. Pass `overrides.source` / `overrides.storage`
 * to inject an in-process PGlite adapter + in-memory storage (the smoke test does this,
 * mirroring scripts/run-eval.ts) so the example runs without a live Postgres.
 */
export function buildConfig(overrides?: {
  source?: PostgresAdapter;
  storage?: RuntimeStorage;
}): ArivieAppConfig {
  const source =
    overrides?.source ??
    postgresSource({ url: requireDatabaseUrl(), readOnlyRole: "arivie_reader" });
  const storage = overrides?.storage ?? postgresRuntime({ url: requireDatabaseUrl() });
  return {
    app: {
      id: process.env.ARIVIE_OWNER_ID ?? "lens-luxe-care",
      name: "Lens & Luxe Customer Care",
    },
    model: resolveModel(),
    context: { root: knowledgePath },
    storage,
    plugins: [
      analytics({
        semanticPath,
        sources: { postgres: source },
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
}

/** Build a live app instance; `overrides` inject PGlite/in-memory for tests. */
export function createArivie(overrides?: {
  source?: PostgresAdapter;
  storage?: RuntimeStorage;
}): ReturnType<typeof defineArivie> {
  return defineArivie(buildConfig(overrides));
}

const config: ArivieAppConfig = buildConfig();
export default config;