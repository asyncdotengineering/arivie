/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Canonical arivie.config.ts for `arivie mcp` + future `arivie eval`.
 *
 * Exports a config object (NOT an instance) as the default export so the
 * CLI's `loadArivieConfig` can pick it up. The scripts under `scripts/`
 * keep their own inline `defineArivie` calls because they wire custom
 * model selection / workspace ergonomics per-script.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createOpenAI } from "@ai-sdk/openai";
import { localWorkspace } from "@arivie/core";
import type { ArivieConfig } from "@arivie/core";
import { postgresAdapter } from "@arivie/db-postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));
const semanticPath = join(__dirname, "semantic");
const skillsPath = join(__dirname, "skills");
const workspaceRoot = join(__dirname, "workspace");

function resolveModel() {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey == null || openaiKey === "") {
    throw new Error("OPENAI_API_KEY is required for arivie.config.ts");
  }
  const openai = createOpenAI({ apiKey: openaiKey });
  return openai(process.env.OPENAI_MODEL ?? "gpt-5-mini");
}

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (url == null || url === "") {
    throw new Error("DATABASE_URL is required for arivie.config.ts");
  }
  return url;
}

const config: ArivieConfig = {
  owner: {
    id: process.env.ARIVIE_OWNER_ID ?? "lumiere-chain",
    name: "Lumière Chain",
  },
  model: resolveModel(),
  semantic: { path: semanticPath, mode: "preload" },
  skills: skillsPath,
  skillsMode: "auto",
  sources: {
    postgres: {
      adapter: postgresAdapter({
        url: requireDatabaseUrl(),
        readOnlyRole: "arivie_reader",
      }),
      description:
        "Lumière F&B operational Postgres — orders, outlets, customers, products, payments, shifts. ~50k rows of synthetic restaurant chain data.",
      useWhen:
        "any revenue, orders, menu performance, outlet comparison, customer behaviour, or staff-shift question",
    },
  },
  workspace: localWorkspace({ at: workspaceRoot, bash: true }),
  compileMetric: true,
  resolveUser: async () => ({
    userId: "arivie-mcp",
    permissions: ["analytics:read"],
    dbRole: "arivie_reader",
  }),
};

export default config;
