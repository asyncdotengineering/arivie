/* SPDX-License-Identifier: Apache-2.0 */
import { postgresAdapter } from "@arivie/db-postgres";

const pg = postgresAdapter({
  url: process.env.DATABASE_URL ?? "postgres://localhost:5432/arivie",
});

export const config = {
  owner: { id: "dogfood-test", name: "Dogfood" },
  model: {},
  storage: pg,
  workspace: { rootDir: "./semantic" },
  sources: {
    postgres: {
      kind: "adapter",
      adapter: pg,
      description: "Setup-config fixture Postgres for CLI tests.",
    },
  },
  semantic: { path: "./semantic", mode: "auto" as const },
  resolveUser: async () => ({
    userId: "cli",
    permissions: [],
    dbRole: "arivie_reader",
  }),
};
