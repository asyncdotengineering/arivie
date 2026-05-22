/* SPDX-License-Identifier: Apache-2.0 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadSemanticLayerSync } from "../src/load.js";
import { parseEntity } from "../src/parse.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("parseEntity", () => {
  it("parses orders.yml into a valid Entity", () => {
    const raw = readFileSync(join(fixturesDir, "orders.yml"), "utf8");
    const result = parseEntity("orders.yml", raw);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.name).toBe("orders");
    expect(result.value.primary_key).toBe("id");
    expect(result.value.measures?.map((m) => m.name)).toEqual([
      "revenue",
      "outstanding_amount",
    ]);
    expect(result.value.dimensions?.map((d) => d.name)).toEqual([
      "status",
      "created_at",
    ]);
    expect(result.value.segments?.[0]?.name).toBe("current_quarter");
    expect(result.value.joins?.[0]?.to).toBe("customers");
    expect(result.value.example_questions).toHaveLength(2);
    expect(result.value.example_queries).toHaveLength(1);
    expect(result.value.source).toEqual({
      adapter: "postgres",
      instance: "primary",
    });
  });

  it("returns ParseError when EntitySchema validation fails", () => {
    const raw = readFileSync(join(fixturesDir, "__bad__.yml"), "utf8");
    const result = parseEntity("__bad__.yml", raw);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error.name).toBe("ParseError");
    expect(result.error.message).toMatch(/primary_key/i);
  });

  it("parses hints array on an entity", () => {
    const raw = readFileSync(join(fixturesDir, "hints.yml"), "utf8");
    const result = parseEntity("hints.yml", raw);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.hints).toEqual(["First hint.", "Second hint."]);
  });

  it("applies default source when the field is omitted", () => {
    const raw = readFileSync(join(fixturesDir, "orders.yml"), "utf8");
    const result = parseEntity("orders.yml", raw);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.source).toEqual({
      adapter: "postgres",
      instance: "primary",
    });
  });

  it("parses explicit object source with instance default", () => {
    const raw = readFileSync(
      join(fixturesDir, "source-mixpanel-entity.yml"),
      "utf8",
    );
    const result = parseEntity("source-mixpanel-entity.yml", raw);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.source).toEqual({
      adapter: "mixpanel",
      instance: "primary",
    });
  });

  it("rejects v0.1 string source values", () => {
    const raw = readFileSync(
      join(fixturesDir, "source-string-entity.yml"),
      "utf8",
    );
    const result = parseEntity("source-string-entity.yml", raw);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error.message).toMatch(/source/i);
  });

  it("loads with-nextjs example semantic layer with correct adapter bindings", () => {
    const exampleSemantic = join(
      dirname(fileURLToPath(import.meta.url)),
      "../../../examples/with-nextjs/semantic",
    );
    const layer = loadSemanticLayerSync(exampleSemantic);
    expect(layer.entities.size).toBeGreaterThan(0);
    // page_views.yml binds to Mixpanel (RFC-003 v2 §4.12 cross-source);
    // every other entity defaults to Postgres via EntitySchema.source.default.
    const mixpanelEntities = new Set(["page_views"]);
    for (const entity of layer.entities.values()) {
      const expectedAdapter = mixpanelEntities.has(entity.name)
        ? "mixpanel"
        : "postgres";
      expect(entity.source).toEqual({
        adapter: expectedAdapter,
        instance: "primary",
      });
    }
  });

  it("returns ParseError on YAML syntax errors", () => {
    const result = parseEntity("broken.yml", ": : :");

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error.name).toBe("ParseError");
    expect(result.error.code).toBe("YAML_PARSE_ERROR");
  });
});
