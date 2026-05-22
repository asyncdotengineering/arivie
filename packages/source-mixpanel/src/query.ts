/* SPDX-License-Identifier: Apache-2.0 */
import type { MixpanelQuery } from "./types.js";
import { compileMetricForMixpanel } from "./compile-metric.js";

export const READ_ONLY_REQUIRED_MSG =
  "MixpanelAdapter: read-only API token required; got token with write scope";

/** Maps adapter aggregate to Mixpanel segmentation `type`. */
export function aggregateToSegmentationType(
  aggregate: MixpanelQuery["aggregate"] | undefined,
): "general" | "unique" | "average" {
  switch (aggregate) {
    case "average":
      return "average";
    case "sum":
      return "general";
    case "count":
    default:
      return "general";
  }
}

export function requiresSumEndpoint(query: MixpanelQuery): boolean {
  return query.aggregate === "sum" && query.on != null && query.on !== "";
}

export function buildSegmentationSearchParams(
  query: MixpanelQuery,
  projectId: string,
): URLSearchParams {
  const params = new URLSearchParams();
  params.set("project_id", projectId);
  if (query.event) {
    params.set("event", query.event);
  }
  params.set("from_date", query.from_date);
  params.set("to_date", query.to_date);
  if (query.where) {
    params.set("where", query.where);
  }
  if (query.on && !requiresSumEndpoint(query)) {
    params.set("on", query.on);
  }
  params.set("type", aggregateToSegmentationType(query.aggregate));
  return params;
}

export function buildSumSearchParams(
  query: MixpanelQuery,
  projectId: string,
): URLSearchParams {
  const params = new URLSearchParams();
  params.set("project_id", projectId);
  if (query.event) {
    params.set("event", query.event);
  }
  params.set("fromDate", query.from_date);
  params.set("toDate", query.to_date);
  if (query.on) {
    params.set("on", query.on);
  }
  if (query.where) {
    params.set("where", query.where);
  }
  return params;
}

export interface SegmentationSeriesRow {
  date: string;
  value: number;
  event?: string;
  segment?: string;
}

/** Flattens Mixpanel segmentation JSON into tabular rows. */
export function parseSegmentationData(
  data: unknown,
  eventName?: string,
): SegmentationSeriesRow[] {
  if (data == null || typeof data !== "object") {
    return [];
  }
  const root = data as {
    data?: {
      series?: string[];
      values?: Record<string, Record<string, number>>;
    };
    results?: Record<string, number>;
  };

  if (root.results && typeof root.results === "object") {
    return Object.entries(root.results).map(([date, value]) => {
      const row: SegmentationSeriesRow = {
        date,
        value: Number(value),
      };
      if (eventName != null) {
        row.event = eventName;
      }
      return row;
    });
  }

  const series = root.data?.series ?? [];
  const values = root.data?.values ?? {};
  const rows: SegmentationSeriesRow[] = [];

  for (const [segment, byDate] of Object.entries(values)) {
    for (const date of series) {
      const raw = byDate[date];
      if (raw == null) {
        continue;
      }
      rows.push({
        date,
        value: Number(raw),
        event: eventName ?? segment,
        segment,
      });
    }
  }

  if (rows.length === 0 && eventName != null) {
    const direct = values[eventName];
    if (direct) {
      for (const [date, raw] of Object.entries(direct)) {
        rows.push({ date, value: Number(raw), event: eventName });
      }
    }
  }

  return rows;
}

export function sumRowValues(rows: SegmentationSeriesRow[]): number {
  return rows.reduce((acc, r) => acc + r.value, 0);
}

/** @deprecated Use {@link compileMetricForMixpanel} from `./compile-metric.js`. */
export function compileMetricQuery(
  opts: Parameters<typeof compileMetricForMixpanel>[0],
): MixpanelQuery {
  return compileMetricForMixpanel(opts).query;
}
