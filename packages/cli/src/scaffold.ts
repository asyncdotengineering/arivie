/* SPDX-License-Identifier: Apache-2.0 */

export type SemanticMode = "auto" | "preload" | "indexed";

export interface InitScaffoldOptions {
  projectName: string;
  dbUrl: string;
  ownerId: string;
  ownerName: string;
  mode: SemanticMode;
}

/** Template for `./arivie.config.ts` (RFC-003 v2 §4.11). */
export function arivieConfigTemplate(opts: InitScaffoldOptions): string {
  return `/* SPDX-License-Identifier: Apache-2.0 */
// Project: ${opts.projectName}
import { defineAgent, defineArivie } from "@arivie/core";
import { analytics } from "@arivie/plugin-analytics";
import { postgresRuntime, postgresSource } from "@arivie/plugin-postgres";
import { anthropic } from "@ai-sdk/anthropic";

export const arivie = await defineArivie({
  app: { id: ${JSON.stringify(opts.ownerId)}, name: ${JSON.stringify(opts.ownerName)} },
  storage: postgresRuntime({ url: process.env.DATABASE_URL! }),
  model: anthropic("claude-sonnet-4-20250514"),
  plugins: [
    analytics({
      semanticPath: "./semantic",
      mode: ${JSON.stringify(opts.mode)},
      sources: {
        postgres: postgresSource({
          url: process.env.DATABASE_URL!,
          readOnlyRole: "arivie_reader",
        }),
      },
      compileMetric: true,
    }),
  ],
  agents: {
    analyst: defineAgent({
      instructions: "Answer analytics questions with concise, SQL-backed evidence.",
      capabilities: ["analytics.query", "analytics.compile_metric"],
    }),
  },
  context: { root: "./semantic" },
  resolveUser: async (_req) => {
    // TODO: wire your auth provider (Clerk, WorkOS, Better Auth, Auth.js, or custom JWT)
    return {
      userId: "anonymous",
      permissions: ["analytics:read"],
      dbRole: "arivie_reader",
    };
  },
});
`;
}

/** Template for `./.env.example`. */
export function envExampleTemplate(opts: InitScaffoldOptions): string {
  return `# Arivie — ${opts.projectName}
DATABASE_URL=${opts.dbUrl}
ARIVIE_OWNER_ID=${opts.ownerId}
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
`;
}

/** Template for `./app/api/arivie/route.ts` (Next.js App Router). */
export function routeTemplate(): string {
  return `/* SPDX-License-Identifier: Apache-2.0 */
import { arivie } from "../../../arivie.config.js";

// Web Standard handler — drops into any host that speaks Fetch
// (Next.js App Router, Bun.serve, Hono, Cloudflare Workers, TanStack Start).
export const POST = arivie.handler;
`;
}

/** Empty placeholder for \`semantic/entities/.gitkeep\`. */
export function entitiesGitkeepTemplate(): string {
  return "";
}
