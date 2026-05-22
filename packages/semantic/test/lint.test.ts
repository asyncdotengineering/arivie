/* SPDX-License-Identifier: Apache-2.0 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LoadError } from "../src/errors.js";
import { loadSemanticLayerSync } from "../src/load.js";
import { parseEntity } from "../src/parse.js";
import { formatLintReport, lint } from "../src/lint.js";
import type { Entity, SemanticLayer } from "../src/types.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function layerFromEntities(entities: Entity[]): SemanticLayer {
  const map = new Map(entities.map((e) => [e.name, e]));
  return {
    entities: map,
    catalog: {
      entities: entities.map((e) => ({
        name: e.name,
        description: e.description,
        keywords: [e.name],
      })),
      generated_at: "2026-01-01T00:00:00.000Z",
      source_files: entities.map((e) => `entities/${e.name}.yml`),
    },
  };
}

function layerFromEntity(entity: Entity): SemanticLayer {
  return layerFromEntities([entity]);
}

const postgresEntity = (
  name: string,
  joins?: Entity["joins"],
): Entity => ({
  name,
  description: `${name} entity`,
  grain: "one row",
  primary_key: "id",
  source: { adapter: "postgres", instance: "primary" },
  joins,
});

const mixpanelEntity = (
  name: string,
  joins?: Entity["joins"],
): Entity => ({
  name,
  description: `${name} entity`,
  grain: "one row",
  primary_key: "id",
  source: { adapter: "mixpanel", instance: "primary" },
  joins,
});

function parseFixture(fileName: string): Entity {
  const raw = readFileSync(join(fixturesDir, fileName), "utf8");
  const result = parseEntity(fileName, raw);
  if (!result.ok) {
    throw result.error;
  }
  return result.value;
}

describe("lint", () => {
  it("reports broken join targets", () => {
    const orders = parseFixture("orders.yml");
    const layer = layerFromEntity(orders);
    const report = lint(layer);

    expect(report.errors.length).toBeGreaterThanOrEqual(1);
    expect(report.errors.some((e) => e.severity === "error")).toBe(true);
    expect(
      report.errors.some((e) => e.code === "BROKEN_JOIN_TARGET"),
    ).toBe(true);
  });

  it("warns on suspect PII columns without pii: true", () => {
    const entity: Entity = {
      name: "users",
      description: "Users",
      grain: "one row per user",
      primary_key: "id",
      columns: [
        {
          name: "email",
          type: "text",
          description: "User email address",
          pii: false,
        },
      ],
    };
    const report = lint(layerFromEntity(entity));

    expect(report.warnings.length).toBeGreaterThanOrEqual(1);
    expect(report.warnings.some((w) => /PII/i.test(w.message))).toBe(true);
  });

  it("passes cross-source join with strategy client-side", () => {
    const orders = postgresEntity("orders", [
      {
        to: "events",
        on: "orders.user_id = events.distinct_id",
        strategy: "client-side",
      },
    ]);
    const events = mixpanelEntity("events");
    const report = lint(layerFromEntities([orders, events]));

    expect(
      report.errors.filter((e) => e.code.startsWith("CROSS_SOURCE")),
    ).toHaveLength(0);
    expect(
      report.errors.filter((e) => e.code === "JOIN_STRATEGY_MATERIALISED_RESERVED"),
    ).toHaveLength(0);
  });

  it("errors on cross-source join without strategy", () => {
    const orders = postgresEntity("orders", [
      { to: "events", on: "orders.user_id = events.distinct_id" },
    ]);
    const events = mixpanelEntity("events");
    const report = lint(layerFromEntities([orders, events]));

    expect(report.errors).toContainEqual(
      expect.objectContaining({
        code: "CROSS_SOURCE_JOIN_MISSING_STRATEGY",
        message:
          'cross-source join missing strategy: declare strategy: "client-side"',
        entity: "orders",
      }),
    );
  });

  it("errors on any join with strategy materialised", () => {
    const orders = postgresEntity("orders", [
      {
        to: "customers",
        on: "orders.customer_id = customers.id",
        strategy: "materialised",
      },
    ]);
    const customers = postgresEntity("customers");
    const report = lint(layerFromEntities([orders, customers]));

    expect(report.errors).toContainEqual(
      expect.objectContaining({
        code: "JOIN_STRATEGY_MATERIALISED_RESERVED",
        message: "strategy: materialised is reserved for v0.3+",
        entity: "orders",
      }),
    );
  });

  it("does not require strategy on same-source joins", () => {
    const orders = postgresEntity("orders", [
      { to: "customers", on: "orders.customer_id = customers.id" },
    ]);
    const customers = postgresEntity("customers");
    const report = lint(layerFromEntities([orders, customers]));

    expect(
      report.errors.filter(
        (e) =>
          e.code === "CROSS_SOURCE_JOIN_MISSING_STRATEGY" ||
          e.code === "JOIN_STRATEGY_MATERIALISED_RESERVED",
      ),
    ).toHaveLength(0);
  });

  it("suggests preload mode for the small orders fixture layer", () => {
    const orders = parseFixture("orders.yml");
    const layer: SemanticLayer = {
      entities: new Map([
        ["orders", orders],
        [
          "customers",
          {
            name: "customers",
            description: "Customers",
            grain: "one row per customer",
            primary_key: "id",
          },
        ],
      ]),
      catalog: {
        entities: [],
        generated_at: "2026-01-01T00:00:00.000Z",
        source_files: [],
      },
    };

    const report = lint(layer);
    expect(report.stats.suggestedMode).toBe("preload");
  });
});

describe("loadSemanticLayerSync lint integration", () => {
  it("throws LoadError when cross-source join omits strategy", () => {
    const root = mkdtempSync(join(tmpdir(), "arivie-lint-load-"));
    const entitiesDir = join(root, "entities");
    mkdirSync(entitiesDir, { recursive: true });
    writeFileSync(
      join(entitiesDir, "orders.yml"),
      `name: orders
description: Orders
grain: one row per order
primary_key: id
source:
  adapter: postgres
joins:
  - to: events
    on: "orders.user_id = events.distinct_id"
`,
      "utf8",
    );
    writeFileSync(
      join(entitiesDir, "events.yml"),
      `name: events
description: Events
grain: one row per event
primary_key: event_id
source:
  adapter: mixpanel
`,
      "utf8",
    );

    expect(() => loadSemanticLayerSync(root)).toThrow(LoadError);
    try {
      loadSemanticLayerSync(root);
      expect.fail("expected LoadError");
    } catch (err) {
      expect(err).toBeInstanceOf(LoadError);
      if (err instanceof LoadError) {
        expect(
          err.errors.some(
            (e) =>
              e.message ===
              'cross-source join missing strategy: declare strategy: "client-side"',
          ),
        ).toBe(true);
      }
    }
  });
});

describe("formatLintReport", () => {
  it("formats warnings and errors for snapshot", () => {
    const report = lint({
      entities: new Map([
        [
          "broken",
          {
            name: "broken",
            description: "Broken entity",
            grain: "one row",
            primary_key: "",
            joins: [{ to: "missing", on: "broken.id = missing.id" }],
          },
        ],
        [
          "users",
          {
            name: "users",
            description: "Users",
            grain: "one row per user",
            primary_key: "id",
            columns: [
              {
                name: "email",
                type: "text",
                description: "Email",
                pii: false,
              },
            ],
          },
        ],
      ]),
      catalog: {
        entities: [],
        generated_at: "2026-01-01T00:00:00.000Z",
        source_files: [],
      },
    });

    expect(formatLintReport(report)).toMatchInlineSnapshot(`
      "Arivie semantic-layer lint
      ===========================
      entities:        2
      total tokens:    76
      suggested mode:  preload

      Warnings (1):
        [SUSPECT_PII_COLUMN] Column "email" on entity "users" looks like PII but pii is not true  (entity: users)

      Errors (2):
        [MISSING_PRIMARY_KEY] Entity "broken" is missing primary_key  (entity: broken)
        [BROKEN_JOIN_TARGET] Entity "broken" join references unknown entity "missing"  (entity: broken)"
    `);
  });
});
