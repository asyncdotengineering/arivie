/* SPDX-License-Identifier: Apache-2.0 */
import { postgresAdapter } from "@arivie/db-postgres";

const pg = postgresAdapter({
  url: process.env.DATABASE_URL ?? "postgres://localhost:5432/arivie",
});

export const config = {
  app: { id: "dogfood-test", name: "Dogfood" },
  model: {},
  storage: {},
  plugins: [
    {
      definition: { id: "analytics", version: "0.0.0" },
      config: {
        semanticPath: "./semantic",
        mode: "auto" as const,
        sources: { postgres: pg },
      },
    },
  ],
  agents: {},
  context: { root: "./semantic" },
  resolveUser: async () => ({
    userId: "cli",
    permissions: [],
    dbRole: "arivie_reader",
  }),
};
