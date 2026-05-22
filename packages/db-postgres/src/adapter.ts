/* SPDX-License-Identifier: Apache-2.0 */
import { createHash } from "node:crypto";
import postgres from "postgres";
import { compileMetricForPostgres } from "./compile-metric.js";
import { executeImpl } from "./execute.js";
import { introspect } from "./introspect.js";
import { setupRole } from "./setup-role.js";
import type { PostgresAdapter, PostgresAdapterOptions } from "./types.js";
import { verifyOwnerIdentity } from "./verify.js";

/** Credential-safe adapter id for audit logs (RFC-003 v2 §4.7). */
export function derivePostgresAdapterId(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname || "localhost";
    const db = parsed.pathname.replace(/^\//, "") || "postgres";
    return `postgres:${host}/${db}`;
  } catch {
    const hash = createHash("sha256").update(url).digest("hex").slice(0, 12);
    return `postgres:${hash}`;
  }
}

export function postgresAdapter(opts: PostgresAdapterOptions): PostgresAdapter {
  const sql = postgres(opts.url, {
    max: opts.maxConnections ?? 10,
    idle_timeout: (opts.idleTimeoutMs ?? 30_000) / 1000,
    onnotice: () => {},
  });

  return {
    kind: "postgres",
    id: derivePostgresAdapterId(opts.url),
    url: opts.url,
    sql,
    execute: (executeOpts) => executeImpl(sql, executeOpts),
    introspect: () => introspect(sql),
    verifyOwnerIdentity: (expectedOwnerId) =>
      verifyOwnerIdentity(sql, expectedOwnerId),
    setupRole: (role, options) => setupRole(sql, role, options),
    compileMetric: compileMetricForPostgres,
    close: async () => {
      await sql.end();
    },
  };
}
