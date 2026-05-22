/* SPDX-License-Identifier: Apache-2.0 */
// Project: foo
import { defineArivie } from "@arivie/core";
import { postgresAdapter } from "@arivie/db-postgres";
import { anthropic } from "@ai-sdk/anthropic";

export const arivie = await defineArivie({
  owner: { id: "dogfood-test", name: "Test Owner" },
  model: anthropic("claude-sonnet-4-20250514"),
  workspace: { rootDir: "./semantic" },
  sources: {
    postgres: postgresAdapter({
      url: process.env.DATABASE_URL!,
      readOnlyRole: "arivie_reader",
    }),
  },
  semantic: { path: "./semantic", mode: "auto" },
  resolveUser: async (_req) => {
    // TODO: wire your auth provider (Clerk, WorkOS, Better Auth, Auth.js, or custom JWT)
    return {
      userId: "anonymous",
      permissions: ["analytics:read"],
      dbRole: "arivie_reader",
    };
  },
});
