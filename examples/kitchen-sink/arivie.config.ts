/* SPDX-License-Identifier: Apache-2.0 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createOpenAI } from "@ai-sdk/openai";
import {
  defineArivie,
  defineSchedules,
  localWorkspace,
  type ArivieConfig,
} from "@arivie/core";
import { postgresAdapter } from "@arivie/db-postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));
const semanticPath = join(__dirname, "semantic");
const skillsPath = join(__dirname, "skills");
const workspaceRoot = join(__dirname, "workspace");

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value == null || value.length === 0) {
    throw new Error(`${name} is required for the kitchen-sink example`);
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

export const config: ArivieConfig = {
  owner: {
    id: process.env.ARIVIE_OWNER_ID ?? "northstar-hospitality",
    name: "Northstar Hospitality",
  },
  storage: pg,
  model: openai(process.env.OPENAI_MODEL ?? "gpt-4o-mini"),
  semantic: { path: semanticPath, mode: "preload" },
  sources: {
    postgres: {
      kind: "adapter",
      adapter: pg,
      description:
        "Northstar Hospitality POS Postgres: outlets, tickets, menu items, line items, and closeout events.",
      useWhen:
        "revenue, voids, comps, menu mix, closeout alerts, outlet comparisons, and F&B operating questions",
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
    // Demonstrates HITL policy configuration. The unattended spike avoids
    // prompts that trigger approval-gated bash/file-write tools.
    requireToolApproval: { tools: ["workspace_bash"] },
  },
  hooks: {
    onBeforeQuery: async ({ userId, sql }) => {
      console.log(`[kitchen-sink hook] before query user=${userId} sql=${sql?.slice(0, 64) ?? "n/a"}`);
    },
    onAfterQuery: async ({ rows, durationMs }) => {
      console.log(`[kitchen-sink hook] after query rows=${rows.length} durationMs=${durationMs}`);
    },
    onToolCall: async ({ tool }) => {
      console.log(`[kitchen-sink hook] tool=${tool}`);
    },
    onMemorySave: async ({ scope, userId }) => {
      console.log(`[kitchen-sink hook] memory save scope=${scope} user=${userId}`);
    },
  },
  resolveUser: async () => ({
    userId: "northstar-gm",
    permissions: ["analytics:read", "ops:read"],
    dbRole: "arivie_reader",
  }),
};

export const arivie = await defineArivie(config);

export default arivie;
