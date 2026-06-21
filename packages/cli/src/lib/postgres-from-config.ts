/* SPDX-License-Identifier: Apache-2.0 */
import type { PostgresAdapter } from "@arivie/db-postgres";
import type { CliArivieConfig } from "./app-config.js";
import { postgresAdapterFromAnalytics } from "./app-config.js";

/**
 * Pulls the underlying PostgresAdapter from `config.storage` — that's
 * where Mastra-Memory + owner-identity routing lives. Used by the CLI
 * commands that need to introspect / setup / manage the storage DB.
 *
 * As of the storage-slot refactor, sources are no longer required to
 * contain a "postgres" key; storage is its own top-level slot.
 */
export function postgresAdapterFromConfig(
  config: CliArivieConfig,
): PostgresAdapter {
  return postgresAdapterFromAnalytics(config);
}
