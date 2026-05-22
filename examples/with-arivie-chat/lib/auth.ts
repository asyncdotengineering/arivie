/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Better Auth server config. Uses Postgres (same DB as Arivie's owner
 * identity + Mastra Memory storage) via the `database` option's pg
 * connection string. No external adapter package — Better Auth ships
 * its own pg-pool builder.
 *
 * Auth tables (`user`, `session`, `account`, `verification`) auto-
 * migrate on first request. Set BETTER_AUTH_SECRET in .env.local.
 */
import { betterAuth } from "better-auth";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const auth = betterAuth({
  database: pool,
  baseURL:
    process.env.BETTER_AUTH_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "http://localhost:3000",
  secret:
    process.env.BETTER_AUTH_SECRET ?? "dev-only-secret-change-in-production",
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 1 day refresh
  },
  plugins: [],
});

export type Session = typeof auth.$Infer.Session;
