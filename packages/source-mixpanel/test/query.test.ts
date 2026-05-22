/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import {
  aggregateToSegmentationType,
  buildSegmentationSearchParams,
  buildSumSearchParams,
  compileMetricQuery,
  parseSegmentationData,
  requiresSumEndpoint,
} from "../src/query.js";
import { probeWriteScope } from "../src/execute.js";

describe("query helpers", () => {
  it("maps aggregates to Mixpanel segmentation types", () => {
    expect(aggregateToSegmentationType("count")).toBe("general");
    expect(aggregateToSegmentationType("average")).toBe("average");
    expect(aggregateToSegmentationType(undefined)).toBe("general");
  });

  it("detects sum endpoint requirement", () => {
    expect(
      requiresSumEndpoint({
        from_date: "2026-01-01",
        to_date: "2026-01-02",
        aggregate: "sum",
        on: 'properties["price"]',
      }),
    ).toBe(true);
    expect(
      requiresSumEndpoint({
        from_date: "2026-01-01",
        to_date: "2026-01-02",
        aggregate: "count",
      }),
    ).toBe(false);
  });

  it("builds segmentation and sum search params", () => {
    const q = {
      event: "Purchased",
      from_date: "2026-05-01",
      to_date: "2026-05-07",
      where: 'properties["plan"] == "pro"',
      on: 'properties["amount"]',
      aggregate: "sum" as const,
    };
    const seg = buildSegmentationSearchParams(q, "99");
    expect(seg.get("event")).toBe("Purchased");
    expect(seg.get("where")).toBe('properties["plan"] == "pro"');

    const sum = buildSumSearchParams(q, "99");
    expect(sum.get("on")).toBe('properties["amount"]');
    expect(sum.get("fromDate")).toBe("2026-05-01");
  });

  it("parseSegmentationData handles empty and results shapes", () => {
    expect(parseSegmentationData(null)).toEqual([]);
    expect(
      parseSegmentationData({ results: { "2026-05-01": 3, "2026-05-02": 7 } }, "E"),
    ).toEqual([
      { date: "2026-05-01", value: 3, event: "E" },
      { date: "2026-05-02", value: 7, event: "E" },
    ]);
  });

  it("compileMetricQuery maps SUM and AVG measures", () => {
    const sumQ = compileMetricQuery({
      entity: {
        name: "events",
        description: "d",
        grain: "g",
        primary_key: "id",
        measures: [{ name: "revenue", sql: "SUM(amount)" }],
        dimensions: [{ name: "event_name", sql: "event_name", type: "text" }],
      },
      metric: "revenue",
      filters: { event: "Purchased" },
    });
    expect(sumQ.aggregate).toBe("sum");
    expect(sumQ.event).toBe("Purchased");
    expect(sumQ.on).toBeDefined();

    const avgQ = compileMetricQuery({
      entity: {
        name: "events",
        description: "d",
        grain: "g",
        primary_key: "id",
        measures: [{ name: "avg_val", sql: "AVG(x)" }],
      },
      metric: "avg_val",
    });
    expect(avgQ.aggregate).toBe("average");
  });

  it("compileMetricQuery throws for unknown metric", () => {
    expect(() =>
      compileMetricQuery({
        entity: {
          name: "events",
          description: "d",
          grain: "g",
          primary_key: "id",
        },
        metric: "missing",
      }),
    ).toThrow("metric 'missing' not found");
  });
});

describe("probeWriteScope", () => {
  it("returns false for 401/403 and true for successful import", async () => {
    const denied = await probeWriteScope({
      projectToken: "t",
      projectId: "1",
      queryBaseUrl: "https://mixpanel.com/api/query",
      importBaseUrl: "https://api.mixpanel.com",
      fetch: async () =>
        new Response("{}", { status: 403 }),
    });
    expect(denied).toBe(false);

    const writable = await probeWriteScope({
      projectToken: "t",
      projectId: "1",
      queryBaseUrl: "https://mixpanel.com/api/query",
      importBaseUrl: "https://api.mixpanel.com",
      fetch: async () =>
        new Response(JSON.stringify({ status: "ok", code: 200 }), {
          status: 200,
        }),
    });
    expect(writable).toBe(true);
  });
});
