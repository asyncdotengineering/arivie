/* SPDX-License-Identifier: Apache-2.0 */
import type { ArivieAppConfig } from "@arivie/core";
import type { PostgresAdapter } from "@arivie/db-postgres";
import { ArivieConfigError } from "@arivie/core";

export type CliArivieConfig = ArivieAppConfig;

interface AnalyticsLikeConfig {
  semanticPath: string;
  sources: Record<string, unknown>;
}

export function isArivieAppConfig(value: unknown): value is CliArivieConfig {
  if (value == null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.app != null &&
    typeof v.app === "object" &&
    typeof (v.app as { id?: unknown }).id === "string" &&
    v.storage != null &&
    typeof v.storage === "object" &&
    v.agents != null &&
    typeof v.agents === "object" &&
    typeof v.resolveUser === "function"
  );
}

export function findAnalyticsConfig(config: CliArivieConfig): AnalyticsLikeConfig {
  for (const plugin of config.plugins ?? []) {
    if (plugin.definition.id !== "analytics") continue;
    const candidate = plugin.config as Partial<AnalyticsLikeConfig>;
    if (
      typeof candidate.semanticPath === "string" &&
      candidate.sources != null &&
      typeof candidate.sources === "object"
    ) {
      return candidate as AnalyticsLikeConfig;
    }
  }
  throw new ArivieConfigError(
    "Config must include analytics({ semanticPath, sources }) for this CLI command",
  );
}

export function semanticPathFromConfig(config: CliArivieConfig): string {
  return findAnalyticsConfig(config).semanticPath;
}

export function postgresAdapterFromAnalytics(
  config: CliArivieConfig,
): PostgresAdapter {
  const analytics = findAnalyticsConfig(config);
  for (const source of Object.values(analytics.sources)) {
    if (
      source != null &&
      typeof source === "object" &&
      (source as { kind?: unknown }).kind === "postgres" &&
      typeof (source as { url?: unknown }).url === "string" &&
      typeof (source as { execute?: unknown }).execute === "function"
    ) {
      return source as PostgresAdapter;
    }
  }
  throw new ArivieConfigError(
    "analytics.sources must include a postgresSource(...) for this CLI command",
  );
}

export function ownerIdFromConfig(config: CliArivieConfig): string {
  return config.app.id;
}
