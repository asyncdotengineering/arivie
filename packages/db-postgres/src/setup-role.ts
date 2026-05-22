/* SPDX-License-Identifier: Apache-2.0 */
import type postgres from "postgres";
import { escapeIdent } from "./identifier.js";

/** Stable advisory-lock key for serializing concurrent `setupRole` calls. */
const SETUP_ROLE_LOCK_KEY = 982_374_623;

function isDuplicateRoleError(err: unknown): boolean {
  return (
    err != null &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code: string }).code === "42710"
  );
}

export async function setupRole(
  sql: postgres.Sql,
  role: string,
  options?: { allowedTables?: string[] },
): Promise<void> {
  const roleIdent = escapeIdent(role);

  await sql.unsafe(`SELECT pg_advisory_lock(${SETUP_ROLE_LOCK_KEY})`);
  try {
    try {
      await sql.unsafe(`CREATE ROLE ${roleIdent} LOGIN`);
    } catch (err) {
      if (!isDuplicateRoleError(err)) {
        throw err;
      }
    }

    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS arivie_owner_identity (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    await sql.unsafe(`GRANT USAGE ON SCHEMA public TO ${roleIdent}`);

    const allowedTables = options?.allowedTables;
    if (allowedTables && allowedTables.length > 0) {
      for (const table of allowedTables) {
        await sql.unsafe(
          `GRANT SELECT ON TABLE public.${escapeIdent(table)} TO ${roleIdent}`,
        );
      }
    } else {
      await sql.unsafe(
        `GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${roleIdent}`,
      );
    }

    await sql.unsafe(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ${roleIdent}`,
    );

    // Postgres 16+ changed the default role-membership grant semantics
    // to INHERIT TRUE / SET FALSE — without `WITH SET TRUE`, the
    // connecting user can't `SET ROLE <role>` even though they're a
    // member. The Arivie execute path wraps every query with
    // `SET LOCAL ROLE <reader>; ...` so we MUST grant SET to the
    // current session user. Idempotent on PG14/15 (which already
    // default to SET TRUE) and required on PG16+ / Neon.
    await sql.unsafe(
      `GRANT ${roleIdent} TO CURRENT_USER WITH SET TRUE`,
    );
  } finally {
    await sql.unsafe(`SELECT pg_advisory_unlock(${SETUP_ROLE_LOCK_KEY})`);
  }
}
