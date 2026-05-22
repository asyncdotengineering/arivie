/* SPDX-License-Identifier: Apache-2.0 */
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSemanticLayerSync, type Entity, type SemanticLayer } from "@arivie/semantic";
import { describe, expect, it } from "vitest";
import { compileMetricForPostgres, ToolError } from "../src/index.js";

const fixturesDir = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../agent/test/fixtures",
);
const semWithJoins = loadSemanticLayerSync(join(fixturesDir, "sem-with-joins"));
const semAmbiguousJoin = loadSemanticLayerSync(
  join(fixturesDir, "sem-ambiguous-join"),
);

function entityFrom(
  semantic: SemanticLayer,
  metric: string,
  entityHint?: string,
): Entity {
  const candidates: { entity: Entity }[] = [];
  for (const entity of semantic.entities.values()) {
    for (const measure of entity.measures ?? []) {
      if (measure.name === metric) {
        candidates.push({ entity });
      }
    }
  }
  if (entityHint != null) {
    const match = candidates.find((c) => c.entity.name === entityHint);
    if (match == null) {
      throw new Error(`metric '${metric}' not on entity '${entityHint}'`);
    }
    return match.entity;
  }
  if (candidates.length !== 1) {
    throw new Error(`expected one candidate for '${metric}'`);
  }
  return candidates[0]!.entity;
}

function compileSql(
  semantic: SemanticLayer,
  args: {
    metric: string;
    dimensions?: string[];
    filters?: Record<string, unknown>;
    segments?: string[];
    entityHint?: string;
  },
): { sql: string; params: (string | number | boolean | null)[] } {
  const entity = entityFrom(semantic, args.metric, args.entityHint);
  const { query, params } = compileMetricForPostgres({
    entity,
    metric: args.metric,
    dimensions: args.dimensions,
    filters: args.filters,
    segments: args.segments,
  });
  return { sql: query, params: params ?? [] };
}

describe("compileMetricForPostgres", () => {
  it("single-entity happy path: revenue on orders", () => {
    const { sql, params } = compileSql(semWithJoins, { metric: "revenue" });
    expect(sql).toBe('SELECT (SUM(total_amount)) AS "revenue" FROM orders');
    expect(params).toEqual([]);
  });

  it("with dimensions adds GROUP BY", () => {
    const { sql } = compileSql(semWithJoins, {
      metric: "revenue",
      dimensions: ["status"],
    });
    expect(sql).toBe(
      'SELECT (SUM(total_amount)) AS "revenue", (status) AS "status" FROM orders GROUP BY "status"',
    );
  });

  it("resolves ambiguous metric with entityHint", () => {
    const entity = entityFrom(semWithJoins, "total", "orders");
    const { query } = compileMetricForPostgres({ entity, metric: "total" });
    expect(query).toBe('SELECT (COUNT(*)) AS "total" FROM orders');
  });

  it("inlines segment SQL into WHERE", () => {
    const { sql } = compileSql(semWithJoins, {
      metric: "revenue",
      segments: ["current_quarter"],
    });
    expect(sql).toBe(
      "SELECT (SUM(total_amount)) AS \"revenue\" FROM orders WHERE (created_at >= date_trunc('quarter', CURRENT_DATE))",
    );
  });

  it("emits LEFT JOIN for cross-entity dimension", () => {
    const { sql } = compileSql(semWithJoins, {
      metric: "revenue",
      dimensions: ["customers.region"],
    });
    expect(sql).toBe(
      'SELECT (SUM(total_amount)) AS "revenue", (customers.region) AS "customers.region" FROM orders LEFT JOIN customers ON orders.customer_id = customers.id GROUP BY "customers.region"',
    );
  });

  it("throws join-ambiguous when multiple paths to same entity", () => {
    expect(() =>
      compileSql(semAmbiguousJoin, {
        metric: "revenue",
        dimensions: ["customers.region"],
        entityHint: "orders_ambiguous",
      }),
    ).toThrow(ToolError);
  });

  it("parameterises string filter", () => {
    const { sql, params } = compileSql(semWithJoins, {
      metric: "revenue",
      filters: { status: "completed" },
    });
    expect(sql).toContain("status = $1");
    expect(params).toEqual(["completed"]);
  });

  it("throws filter-invalid for nested object values", () => {
    const entity = entityFrom(semWithJoins, "revenue");
    expect(() =>
      compileMetricForPostgres({
        entity,
        metric: "revenue",
        filters: { x: { nested: "obj" } },
      }),
    ).toThrow(ToolError);
  });
});
