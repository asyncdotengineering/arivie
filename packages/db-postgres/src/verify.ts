/* SPDX-License-Identifier: Apache-2.0 */
import type postgres from "postgres";
import { ArivieBoundaryError } from "./errors.js";

export async function verifyOwnerIdentity(
  sql: postgres.Sql,
  expectedOwnerId: string,
): Promise<void> {
  const rows = await sql`
    SELECT value FROM arivie_owner_identity WHERE key = 'owner_id'
  `;

  if (rows.length === 0) {
    throw new ArivieBoundaryError(
      {
        reason: "identity-table-missing",
        expected: expectedOwnerId,
      },
      "arivie_owner_identity table missing or empty; run 'arivie setup' first",
    );
  }

  const dbValue = rows[0]?.value;
  if (dbValue !== expectedOwnerId) {
    throw new ArivieBoundaryError(
      {
        reason: "identity-mismatch",
        dbValue,
        expected: expectedOwnerId,
      },
      `owner identity mismatch: database has '${String(dbValue)}', expected '${expectedOwnerId}'`,
    );
  }
}
