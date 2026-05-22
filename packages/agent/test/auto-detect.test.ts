/* SPDX-License-Identifier: Apache-2.0 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  estimateTokens,
  loadSemanticLayerSync,
  parseEntity,
  type Entity,
  type SemanticLayer,
} from "@arivie/semantic";
import { autoDetectMode } from "../src/auto-detect.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function emptyLayer(): SemanticLayer {
  return {
    entities: new Map(),
    catalog: {
      entities: [],
      generated_at: "2026-01-01T00:00:00.000Z",
      source_files: [],
    },
  };
}

function layerFromEntities(entities: Entity[]): SemanticLayer {
  return {
    entities: new Map(entities.map((entity) => [entity.name, entity])),
    catalog: {
      entities: entities.map((entity) => ({
        name: entity.name,
        description: entity.description,
        keywords: [entity.name],
      })),
      generated_at: "2026-01-01T00:00:00.000Z",
      source_files: entities.map((e) => `entities/${e.name}.yml`),
    },
  };
}

function syntheticLayer(charCount: number): SemanticLayer {
  const payload = "a".repeat(charCount);
  const entity: Entity = {
    name: "synthetic",
    description: payload,
    grain: "one row",
    primary_key: "id",
  };
  return layerFromEntities([entity]);
}

function tokenCountForLayer(layer: SemanticLayer): number {
  const serialized = JSON.stringify(
    [...layer.entities.values()].sort((a, b) => a.name.localeCompare(b.name)),
  );
  return estimateTokens(serialized);
}

function syntheticLayerWithTokens(targetTokens: number): SemanticLayer {
  let charCount = Math.max(0, targetTokens * 4);
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const layer = syntheticLayer(charCount);
    const tokens = tokenCountForLayer(layer);
    if (tokens === targetTokens) {
      return layer;
    }
    charCount += (targetTokens - tokens) * 4;
  }
  return syntheticLayer(charCount);
}

describe("autoDetectMode", () => {
  it("returns preload for an empty layer", () => {
    expect(autoDetectMode(emptyLayer())).toBe("preload");
  });

  it("returns preload for one small entity", () => {
    const entity: Entity = {
      name: "orders",
      description: "Small orders entity",
      grain: "one row per order",
      primary_key: "id",
    };
    expect(autoDetectMode(layerFromEntities([entity]))).toBe("preload");
  });

  it("returns preload for the sem-5 fixture", () => {
    const layer = loadSemanticLayerSync(join(fixturesDir, "sem-5"));
    expect(layer.entities.size).toBe(5);
    expect(autoDetectMode(layer)).toBe("preload");
  });

  it("returns indexed for the sem-60 fixture", () => {
    const layer = loadSemanticLayerSync(join(fixturesDir, "sem-60"));
    expect(layer.entities.size).toBe(60);
    expect(autoDetectMode(layer)).toBe("indexed");
  });

  it("returns indexed for a mid-sized synthetic layer", () => {
    const layer = syntheticLayerWithTokens(20_000);
    expect(tokenCountForLayer(layer)).toBe(20_000);
    expect(autoDetectMode(layer)).toBe("indexed");
  });

  it("returns indexed just above the 8k preload ceiling", () => {
    const layer = syntheticLayerWithTokens(8000);
    expect(autoDetectMode(layer)).toBe("indexed");
  });

  it("returns preload just below the 8k preload ceiling", () => {
    const layer = syntheticLayerWithTokens(7999);
    expect(autoDetectMode(layer)).toBe("preload");
  });

  it("uses the same serialization as estimateTokens in lint", () => {
    const ordersRaw = readFileSync(
      join(fixturesDir, "sem-5", "entities", "orders.yml"),
      "utf8",
    );
    const orders = parseEntity("entities/orders.yml", ordersRaw);
    if (!orders.ok) {
      throw orders.error;
    }
    const layer = layerFromEntities([orders.value]);
    const serialized = JSON.stringify([orders.value]);
    expect(estimateTokens(serialized)).toBe(
      estimateTokens(
        JSON.stringify(
          [...layer.entities.values()].sort((a, b) =>
            a.name.localeCompare(b.name),
          ),
        ),
      ),
    );
  });
});
