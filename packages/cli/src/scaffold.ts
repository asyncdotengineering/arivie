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

export const arivie = await defineArivie({
  owner: { id: ${JSON.stringify(opts.ownerId)}, name: ${JSON.stringify(opts.ownerName)} },
  model: anthropic("claude-sonnet-4-20250514"),
  workspace: { rootDir: "./semantic" },
  sources: {
    postgres: postgresAdapter({
      url: process.env.DATABASE_URL!,
      readOnlyRole: "arivie_reader",
    }),
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

export const POST = arivie.next.POST;
`;
}

/** Empty placeholder for \`semantic/entities/.gitkeep\`. */
export function entitiesGitkeepTemplate(): string {
  return "";
}
