/* SPDX-License-Identifier: Apache-2.0 */
import type { SourceAdapterCompileMetricOpts } from "@arivie/core/types";
import type { MixpanelQuery } from "./types.js";

function defaultDateRange(): { from_date: string; to_date: string } {
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 30);
  return {
    from_date: formatDate(from),
    to_date: formatDate(to),
  };
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Compiles a semantic-layer measure on a Mixpanel-bound entity to a Query API payload.
 */
export function compileMetricForMixpanel(
  opts: SourceAdapterCompileMetricOpts,
): { query: MixpanelQuery; params?: unknown[] } {
  const { entity, metric } = opts;
  const measure = entity.measures?.find((m) => m.name === metric);
  if (measure == null) {
    throw new Error(
      `compileMetricForMixpanel: metric '${metric}' not found on entity '${entity.name}'`,
    );
  }

  const range = defaultDateRange();
  const sql = measure.sql.toLowerCase();
  let aggregate: MixpanelQuery["aggregate"] = "count";
  if (sql.includes("sum(")) {
    aggregate = "sum";
  } else if (sql.includes("avg(") || sql.includes("average")) {
    aggregate = "average";
  }

  const eventDim = entity.dimensions?.find((d) => d.name === "event_name");
  const event =
    typeof opts.filters?.event_name === "string"
      ? opts.filters.event_name
      : typeof opts.filters?.event === "string"
        ? opts.filters.event
        : eventDim != null
          ? undefined
          : entity.name;

  const query: MixpanelQuery = {
    ...range,
    aggregate,
    ...(event != null ? { event } : {}),
  };

  if (aggregate === "sum") {
    const onDim = entity.dimensions?.find((d) => d.name !== "event_name");
    query.on = onDim?.sql ?? 'properties["$amount"]';
  }

  return { query };
}
