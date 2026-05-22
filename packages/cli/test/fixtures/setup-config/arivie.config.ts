/* SPDX-License-Identifier: Apache-2.0 */
import { postgresAdapter } from "@arivie/db-postgres";

export const config = {
  owner: { id: "dogfood-test", name: "Dogfood" },
  model: {},
  workspace: { rootDir: "./semantic" },
  sources: {
    postgres: postgresAdapter({
      url: process.env.DATABASE_URL ?? "postgres://localhost:5432/arivie",
    }),
  },
  semantic: { path: "./semantic", mode: "auto" as const },
  resolveUser: async () => ({
    userId: "cli",
    permissions: [],
    dbRole: "arivie_reader",
  }),
};
