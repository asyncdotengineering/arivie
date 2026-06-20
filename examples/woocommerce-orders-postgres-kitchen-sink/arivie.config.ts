/* SPDX-License-Identifier: Apache-2.0 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createOpenAI } from "@ai-sdk/openai";
import { defineArivie, defineSchedules, localWorkspace, type ArivieConfig } from "@arivie/core";
import { postgresAdapter } from "@arivie/db-postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));
const semanticPath = join(__dirname, "semantic");
const skillsPath = join(__dirname, "skills");
const workspaceRoot = join(__dirname, "workspace");

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value == null || value.length === 0) {
    throw new Error(`${name} is required for the WooCommerce orders Postgres kitchen-sink example`);
  }
  return value;
}

const pg = postgresAdapter({
  url: requireEnv("DATABASE_URL"),
  readOnlyRole: "arivie_reader",
});

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

export const config: ArivieConfig = {
  owner: {
    id: process.env.ARIVIE_OWNER_ID ?? "woocommerce-demo-store",
    name: "WooCommerce Demo Store",
  },
  storage: pg,
  model: openai(process.env.OPENAI_MODEL ?? "gpt-4o-mini"),
  semantic: { path: semanticPath, mode: "preload" },
  sources: {
    postgres: {
      kind: "adapter",
      adapter: pg,
      description:
        "WooCommerce orders normalized into Postgres tables for revenue, product, variant, coupon, refund, tax, shipping, customer, and payment analytics.",
      useWhen:
        "WooCommerce store analytics, order status trends, product and variant revenue, coupons, refunds, taxes, shipping, fees, payment methods, countries, and repeat customers",
    },
  },
  skills: skillsPath,
  skillsMode: "auto",
  workspace: localWorkspace({ at: workspaceRoot, bash: true }),
  compileMetric: true,
  schedules,
  limits: {
    rowsPerQuery: 500,
    queryTimeoutMs: 10_000,
    maxSteps: 8,
    requireToolApproval: { tools: ["workspace_bash"] },
  },
  hooks: {
    onBeforeQuery: async ({ userId, sql }) => {
      console.log(`[woocommerce hook] before query user=${userId} sql=${sql?.slice(0, 80) ?? "n/a"}`);
    },
    onAfterQuery: async ({ rows, durationMs }) => {
      console.log(`[woocommerce hook] after query rows=${rows.length} durationMs=${durationMs}`);
    },
    onToolCall: async ({ tool }) => {
      console.log(`[woocommerce hook] tool=${tool}`);
    },
    onMemorySave: async ({ scope, userId }) => {
      console.log(`[woocommerce hook] memory save scope=${scope} user=${userId}`);
    },
  },
  resolveUser: async () => ({
    userId: "woocommerce-analyst",
    permissions: ["analytics:read", "finance:read"],
    dbRole: "arivie_reader",
  }),
};

export const arivie = await defineArivie(config);

export default arivie;
