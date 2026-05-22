/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { composeSemantic } from "../src/compose.js";
import { defineEntity } from "../src/define.js";

describe("composeSemantic", () => {
  it("builds a SemanticLayer with a Map of entities keyed by name", () => {
    const orders = defineEntity({
      name: "orders",
      description: "Customer orders.",
      grain: "one row per order",
      primary_key: "id",
    });
    const customers = defineEntity({
      name: "customers",
      description: "Customer records.",
      grain: "one row per customer",
      primary_key: "id",
    });

    const layer = composeSemantic({ entities: [orders, customers] });

    expect(layer.entities).toBeInstanceOf(Map);
    expect(layer.entities.size).toBe(2);
    expect(layer.entities.get("orders")).toBe(orders);
    expect(layer.entities.get("customers")).toBe(customers);
  });

  it("derives a default catalog from the entities", () => {
    const orders = defineEntity({
      name: "orders",
      description: "Customer orders.",
      grain: "one row per order",
      primary_key: "id",
    });

    const layer = composeSemantic({ entities: [orders] });

    expect(layer.catalog.entities).toEqual([
      { name: "orders", description: "Customer orders.", keywords: ["orders"] },
    ]);
    expect(layer.catalog.generated_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
    );
  });

  it("sorts catalog entities alphabetically", () => {
    const orders = defineEntity({
      name: "orders",
      description: "x",
      grain: "x",
      primary_key: "id",
    });
    const customers = defineEntity({
      name: "customers",
      description: "x",
      grain: "x",
      primary_key: "id",
    });

    const layer = composeSemantic({ entities: [orders, customers] });
    expect(layer.catalog.entities.map((e) => e.name)).toEqual([
      "customers",
      "orders",
    ]);
  });

  it("accepts catalog overrides", () => {
    const orders = defineEntity({
      name: "orders",
      description: "x",
      grain: "x",
      primary_key: "id",
    });

    const layer = composeSemantic({
      entities: [orders],
      catalog: { source_files: ["entities/orders.yml"] },
    });

    expect(layer.catalog.source_files).toEqual(["entities/orders.yml"]);
    // entities still derived
    expect(layer.catalog.entities[0]?.name).toBe("orders");
  });

  it("returns an empty layer when no entities are passed", () => {
    const layer = composeSemantic({ entities: [] });
    expect(layer.entities.size).toBe(0);
    expect(layer.catalog.entities).toEqual([]);
  });
});
