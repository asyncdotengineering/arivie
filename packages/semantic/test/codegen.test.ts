/* SPDX-License-Identifier: Apache-2.0 */
import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { codegen, renderGeneratedIndex } from "../src/codegen.js";
import { parseEntity } from "../src/parse.js";
import type { SemanticLayer } from "../src/types.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function ordersLayer(): SemanticLayer {
  const raw = readFileSync(join(fixturesDir, "orders.yml"), "utf8");
  const result = parseEntity("orders.yml", raw);
  if (!result.ok) {
    throw result.error;
  }
  return {
    entities: new Map([[result.value.name, result.value]]),
    catalog: {
      entities: [],
      generated_at: "2026-01-01T00:00:00.000Z",
      source_files: ["entities/orders.yml"],
    },
  };
}

describe("codegen", () => {
  let tmpDir: string;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-19T12:00:00.000Z"));
    tmpDir = await mkdtemp(join(tmpdir(), "arivie-semantic-"));
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("writes .generated/index.ts with entity names", async () => {
    await codegen(ordersLayer(), tmpDir);
    const generated = await readFile(
      join(tmpDir, ".generated", "index.ts"),
      "utf8",
    );

    expect(generated).toContain("'orders'");
    expect(generated).toContain("export const entityNames");
    expect(generated).toContain("export type OrdersMeasure");
    expect(generated).toContain("'revenue'");
    expect(generated).toContain("'outstanding_amount'");
  });

  it("matches snapshot for generated content", () => {
    const content = renderGeneratedIndex(ordersLayer());
    expect(content).toMatchSnapshot();
  });
});
