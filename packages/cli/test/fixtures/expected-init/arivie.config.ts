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
    postgres: {
      adapter: postgresAdapter({
        url: process.env.DATABASE_URL!,
        readOnlyRole: "arivie_reader",
      }),
      // Required — one sentence on what's in this source. The agent reads
      // this to know when to call execute_postgres for a question.
      description: "TODO: describe your Postgres source — e.g. \"Production OLTP — customers, orders, payments\".",
      // Optional — when to pick this source over another. Only useful
      // when you declare 2+ sources.
      // useWhen: "any operational entity (customers, orders) question",
    },
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
