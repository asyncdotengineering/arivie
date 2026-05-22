/* SPDX-License-Identifier: Apache-2.0 */
import type { Entity } from "@arivie/semantic";
import { describe, expect, it } from "vitest";
import { ParagraphChunker } from "../src/chunker.js";

function syntheticEntity(overrides: Partial<Entity> = {}): Entity {
  return {
    name: "orders",
    description: "Single paragraph description.",
    grain: "one row per order",
    primary_key: "id",
    measures: [
      {
        name: "revenue",
        description: "Revenue measure",
        sql: "SUM(amount)",
      },
      {
        name: "count",
        description: "Order count",
        sql: "COUNT(*)",
      },
    ],
    dimensions: [
      { name: "status", sql: "status", description: "Order status" },
      { name: "region", sql: "region", description: "Sales region" },
    ],
    segments: [
      {
        name: "completed",
        sql: "status = 'completed'",
        description: "Completed orders only",
      },
    ],
    example_queries: [
      {
        question: "Total revenue?",
        sql: "SELECT SUM(amount) FROM orders",
      },
    ],
    ...overrides,
  };
}

describe("ParagraphChunker", () => {
  it("chunks description, measures, dimensions, segments, and example_queries", () => {
    const chunks = ParagraphChunker.chunk(syntheticEntity());
    expect(chunks).toHaveLength(7);
  });

  it("adds one chunk per hint with hint section metadata", () => {
    const chunks = ParagraphChunker.chunk(
      syntheticEntity({
        hints: ["hint one", "hint two", "hint three"],
      }),
    );
    expect(chunks).toHaveLength(10);
    const hintChunks = chunks.filter((c) => c.metadata.section === "hint");
    expect(hintChunks).toHaveLength(3);
    expect(hintChunks[0]?.metadata.name).toBe("hint-0");
    expect(hintChunks[1]?.metadata.name).toBe("hint-1");
    expect(hintChunks[2]?.metadata.name).toBe("hint-2");
  });

  it("splits multi-paragraph descriptions", () => {
    const chunks = ParagraphChunker.chunk(
      syntheticEntity({ description: "a\n\nb" }),
    );
    const descriptionChunks = chunks.filter(
      (c) => c.metadata.section === "description",
    );
    expect(descriptionChunks).toHaveLength(2);
    expect(descriptionChunks[0]?.metadata.paragraph_idx).toBe(0);
    expect(descriptionChunks[1]?.metadata.paragraph_idx).toBe(1);
    expect(descriptionChunks[0]?.text).toBe("a");
    expect(descriptionChunks[1]?.text).toBe("b");
  });

  it("produces stable ids across runs", () => {
    const entity = syntheticEntity();
    const first = ParagraphChunker.chunk(entity);
    const second = ParagraphChunker.chunk(entity);
    expect(first.map((c) => c.id)).toEqual(second.map((c) => c.id));
    expect(first[0]?.id).toBe("orders/description/0");
    expect(first.find((c) => c.metadata.section === "measure")?.id).toBe(
      "orders/measure/0",
    );
  });

  it("returns a single description chunk for a minimal entity", () => {
    const chunks = ParagraphChunker.chunk({
      name: "minimal",
      description: "Only description.",
      grain: "one row",
      primary_key: "id",
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.metadata.section).toBe("description");
  });

  it("includes measure name in text and metadata", () => {
    const chunks = ParagraphChunker.chunk(syntheticEntity());
    const measure = chunks.find((c) => c.metadata.section === "measure");
    expect(measure?.text).toContain("revenue");
    expect(measure?.text).toContain("SUM(amount)");
    expect(measure?.metadata.name).toBe("revenue");
  });

  it("skips hints when undefined", () => {
    const chunks = ParagraphChunker.chunk(syntheticEntity({ hints: undefined }));
    expect(chunks.some((c) => c.metadata.section === "hint")).toBe(false);
  });
});
