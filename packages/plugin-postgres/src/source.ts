/* SPDX-License-Identifier: Apache-2.0 */
import { postgresAdapter, type PostgresAdapter } from "@arivie/db-postgres";

/**
 * Options for a Postgres analytical source (RFC §5.5). `readOnlyRole` is the
 * least-privilege DB role the agent's queries run as — the read-only boundary
 * (RFC §10.5) is enforced by the underlying adapter, not weakened by moving
 * the source behind the plugin API.
 */
export interface PostgresSourceOptions {
  url: string;
  readOnlyRole?: string;
  allowedSchemas?: string[];
  maxConnections?: number;
  idleTimeoutMs?: number;
}

/**
 * Construct a Postgres analytical source for the analytics plugin to consume
 * through the source contract (RFC §4.5, §5.5). This is the plugin-era entry
 * point so apps import all Postgres capability from `@arivie/plugin-postgres`
 * (runtime storage + source) rather than reaching into `@arivie/db-postgres`
 * directly. The connection is opened lazily on first query.
 */
export function postgresSource(options: PostgresSourceOptions): PostgresAdapter {
  return postgresAdapter(options);
}
