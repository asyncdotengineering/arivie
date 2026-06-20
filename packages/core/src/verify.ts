/* SPDX-License-Identifier: Apache-2.0 */
import { ArivieBoundaryError } from "@arivie/db-postgres";
import type { StorageAdapter } from "./types.js";

const FATAL_BOUNDARY_REASONS = new Set([
  "identity-mismatch",
  "identity-table-missing",
  "unexpected-db-role",
  "role-check-failed",
]);

// [S1-fix-2 KI-1-07] Pi r2 M-r2-4: Postgres SQLSTATE codes that indicate the
// configured credentials are fundamentally wrong. Retrying with the same creds
// is useless and floods logs. Treat as FATAL like boundary errors — cache the
// rejection forever; only an instance restart with corrected creds recovers.
//   28000 — invalid_authorization_specification
//   28P01 — invalid_password
//   3D000 — invalid_catalog_name (DB doesn't exist)
//   3F000 — invalid_schema_name
//   42501 — insufficient_privilege (role can't even read identity table)
const FATAL_POSTGRES_CODES = new Set([
  "28000",
  "28P01",
  "3D000",
  "3F000",
  "42501",
]);

function isPostgresErrorWithCode(err: unknown): err is { code: string } {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    typeof (err as { code: unknown }).code === "string"
  );
}

export function isFatalBoundaryError(err: unknown): boolean {
  if (err instanceof ArivieBoundaryError) {
    const reason = err.detail.reason;
    return typeof reason === "string" && FATAL_BOUNDARY_REASONS.has(reason);
  }
  if (isPostgresErrorWithCode(err) && FATAL_POSTGRES_CODES.has(err.code)) {
    return true;
  }
  return false;
}

export async function verifyOwnerIdentity(
  db: StorageAdapter,
  expectedOwnerId: string,
  readOnlyRole = "arivie_reader",
): Promise<void> {
  await db.verifyOwnerIdentity(expectedOwnerId);

  const rows = await db.sql<{ current_user: string; rolsuper: boolean }[]>`
    SELECT rolname AS current_user, rolsuper
    FROM pg_roles
    WHERE rolname = current_user
  `;
  const currentUser = rows[0]?.current_user;
  const isSuperuser = rows[0]?.rolsuper === true;
  if (!currentUser) {
    throw new ArivieBoundaryError(
      { reason: "role-check-failed", expected: readOnlyRole },
      "could not determine current database role",
    );
  }

  if (currentUser === readOnlyRole) {
    return;
  }

  // [S0-fix-2 pi-#4] Rely on rolsuper boolean alone — Postgres is the source of truth
  // for who is a superuser. The hardcoded SUPERUSER_ROLES Set was redundant + lied
  // about non-superuser membership of standard role names.
  if (isSuperuser) {
    console.warn(
      `[arivie] Connected as privileged role (${currentUser}); expected read-only role '${readOnlyRole}'`,
    );
    return;
  }

  throw new ArivieBoundaryError(
    {
      reason: "unexpected-db-role",
      currentUser,
      expected: readOnlyRole,
    },
    `unexpected database role '${currentUser}'; expected '${readOnlyRole}'`,
  );
}
