/* SPDX-License-Identifier: Apache-2.0 */
import type { ArivieConfig } from "@arivie/core/types";
import type { PostgresAdapter } from "@arivie/db-postgres";
import { ArivieConfigError } from "@arivie/core";

/**
 * Pulls the underlying PostgresAdapter from `config.storage` — that's
 * where Mastra-Memory + owner-identity routing lives. Used by the CLI
 * commands that need to introspect / setup / manage the storage DB.
 *
 * As of the storage-slot refactor, sources are no longer required to
 * contain a "postgres" key; storage is its own top-level slot.
 */
export function postgresAdapterFromConfig(
  config: ArivieConfig,
): PostgresAdapter {
  const storage = config.storage;
  if (storage == null || typeof storage !== "object") {
    throw new ArivieConfigError(
      "config.storage is required (PostgresAdapter)",
    );
  }
  if (!("kind" in storage) || storage.kind !== "postgres") {
    throw new ArivieConfigError(
      'config.storage must be a Postgres storage (kind: "postgres")',
    );
  }
  if (!("url" in storage) || typeof storage.url !== "string") {
    throw new ArivieConfigError(
      "config.storage must expose a connection url",
    );
  }
  return storage as unknown as PostgresAdapter;
}
