/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { defineEntity } from "../src/define.js";

describe("defineEntity", () => {
  it("accepts a minimal valid entity and applies the source default", () => {
    const entity = defineEntity({
      name: "orders",
      description: "Orders placed by customers.",
      grain: "one row per order",
      primary_key: "id",
    });

    expect(entity.name).toBe("orders");
    expect(entity.source).toEqual({ adapter: "postgres", instance: "primary" });
  });

  it("preserves measures, dimensions, and segments verbatim", () => {
    const entity = defineEntity({
      name: "tickets",
      description: "POS tickets.",
      grain: "one row per ticket",
      primary_key: "id",
      measures: [
        { name: "revenue", description: "Net revenue", sql: "SUM(subtotal)" },
      ],
      dimensions: [
        {
          name: "status",
          sql: "status",
          values: ["open", "closed", "voided"],
          type: "text",
        },
      ],
      segments: [
        { name: "current_week", sql: "business_day >= date_trunc('week', CURRENT_DATE)" },
      ],
    });

    expect(entity.measures?.[0]?.name).toBe("revenue");
    expect(entity.dimensions?.[0]?.values).toEqual(["open", "closed", "voided"]);
    expect(entity.segments?.[0]?.name).toBe("current_week");
  });

  it("rejects entities missing required fields", () => {
    expect(() =>
      defineEntity({
        name: "broken",
        // missing description, grain, primary_key
      } as unknown),
    ).toThrowError();
  });

  it("rejects entities with extra keys (strict)", () => {
    expect(() =>
      defineEntity({
        name: "broken",
        description: "x",
        grain: "x",
        primary_key: "id",
        not_a_field: "nope",
      } as unknown),
    ).toThrowError();
  });
});
