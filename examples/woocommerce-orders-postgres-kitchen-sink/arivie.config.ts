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
    throw new Error(`${name} is required for the WooCommerce orders Postgres kitchen-sink example`);
  }
  return value;
}

const databaseUrl = requireEnv("DATABASE_URL");
const openai = createOpenAI({ apiKey: requireEnv("OPENAI_API_KEY") });

export const schedules = defineSchedules([
  {
    id: "daily-woocommerce-sales-brief",
    cron: "0 8 * * *",
    timezone: "America/Chicago",
    prompt: "Run the woocommerce-sales-analyst skill for yesterday and write a Markdown sales brief.",
    metadata: { audience: "merchant-operator", cadence: "daily" },
  },
  {
    id: "weekly-refund-and-coupon-review",
    cron: "0 9 * * 1",
    timezone: "America/Chicago",
    prompt: "Run the woocommerce-reconciliation skill for the previous week. Focus on refunds, coupons, tax, shipping, and payment methods.",
    metadata: { audience: "finance", cadence: "weekly" },
  },
]);

export const config: ArivieAppConfig = {
  app: {
    id: process.env.ARIVIE_OWNER_ID ?? "woocommerce-demo-store",
    name: "WooCommerce Demo Store",
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
      ownerId: process.env.ARIVIE_OWNER_ID ?? "woocommerce-demo-store",
    }),
  ],
  agents: {
    analyst: defineAgent({
      instructions:
        "You are a WooCommerce commerce analyst. Explain revenue, products, refunds, coupons, tax, shipping, customers, and payment trends with precise SQL-backed evidence.",
      capabilities: ["analytics.query", "analytics.compile_metric"],
    }),
  },
  context: { root: semanticPath },
  resolveUser: async () => ({
    userId: "woocommerce-analyst",
    permissions: ["analytics:read", "finance:read"],
    dbRole: "arivie_reader",
  }),
};

export const arivie = await defineArivie(config);

export default arivie;
