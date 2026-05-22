/* SPDX-License-Identifier: Apache-2.0 */
import type { ArivieConfig } from "@arivie/core/types";
import type { PostgresAdapter } from "@arivie/db-postgres";
import { ArivieConfigError } from "@arivie/core";

export function postgresAdapterFromConfig(config: ArivieConfig): PostgresAdapter {
  const entry = config.sources.postgres;
  if (entry == null || typeof entry !== "object") {
    throw new ArivieConfigError('config.sources.postgres is required');
  }
  const adapter =
    "adapter" in entry && entry.adapter != null
      ? entry.adapter
      : "execute" in entry
        ? entry
        : null;
  if (adapter == null || typeof adapter !== "object" || !("url" in adapter)) {
    throw new ArivieConfigError("sources.postgres must be a PostgresAdapter");
  }
  return adapter as PostgresAdapter;
}
