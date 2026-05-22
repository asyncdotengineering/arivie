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
import { defineArivie } from "@arivie/core";
import { postgresAdapter } from "@arivie/db-postgres";
import { anthropic } from "@ai-sdk/anthropic";

// One Postgres adapter shared by storage (Mastra Memory + owner identity)
// AND the agent's execute_<source> tool. Single DB, two roles. If you
// want them on separate DBs, swap the \`storage:\` slot independently.
const pg = postgresAdapter({
  url: process.env.DATABASE_URL!,
  readOnlyRole: "arivie_reader",
});

export const arivie = await defineArivie({
  owner: { id: ${JSON.stringify(opts.ownerId)}, name: ${JSON.stringify(opts.ownerName)} },
  storage: pg,
  model: anthropic("claude-sonnet-4-20250514"),
  workspace: { rootDir: "./semantic" },
  sources: {
    // Rename "postgres" to a domain noun ("commerce", "billing", "crm")
    // — the key is the tool name the agent calls (\`execute_<key>\`).
    postgres: {
      kind: "adapter",
      adapter: pg,
      // Required — one sentence on what's in this source. The agent
      // reads this to know when to call execute_<source> for a question.
      description: "TODO: describe your Postgres source — e.g. \\"Production OLTP — customers, orders, payments\\".",
      // Optional — when to pick this source over another. Only useful
      // when you declare 2+ sources.
      // useWhen: "any operational entity (customers, orders) question",
    },
  },
  semantic: { path: "./semantic", mode: ${JSON.stringify(opts.mode)} },
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
