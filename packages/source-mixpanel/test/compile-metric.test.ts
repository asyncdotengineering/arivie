/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { compileMetricForMixpanel } from "../src/compile-metric.js";

describe("compileMetricForMixpanel", () => {
  it("maps COUNT measure to segmentation count query", () => {
    const { query } = compileMetricForMixpanel({
      entity: {
        name: "events",
        description: "Events",
        grain: "one row",
        primary_key: "id",
        source: { adapter: "mixpanel", instance: "primary" },
        measures: [{ name: "event_count", sql: "COUNT(*)" }],
        dimensions: [{ name: "event_name", sql: "event_name", type: "text" }],
      },
      metric: "event_count",
    });

    expect(query.from_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(query.to_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(query.aggregate).toBe("count");
  });

  it("maps SUM and AVG measures", () => {
    const sumQ = compileMetricForMixpanel({
      entity: {
        name: "revenue_events",
        description: "Revenue",
        grain: "one row",
        primary_key: "id",
        measures: [{ name: "total_revenue", sql: "SUM(amount)" }],
        dimensions: [{ name: "amount", sql: 'properties["$amount"]', type: "number" }],
      },
      metric: "total_revenue",
    });
    expect(sumQ.query.aggregate).toBe("sum");
    expect(sumQ.query.on).toBeDefined();

    const avgQ = compileMetricForMixpanel({
      entity: {
        name: "sessions",
        description: "Sessions",
        grain: "one row",
        primary_key: "id",
        measures: [{ name: "avg_duration", sql: "AVG(duration_sec)" }],
      },
      metric: "avg_duration",
    });
    expect(avgQ.query.aggregate).toBe("average");
  });

  it("throws for unknown metric", () => {
    expect(() =>
      compileMetricForMixpanel({
        entity: {
          name: "events",
          description: "Events",
          grain: "one row",
          primary_key: "id",
        },
        metric: "missing",
      }),
    ).toThrow(/not found/);
  });
});
