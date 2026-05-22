/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runTypesCommand } from "../src/commands/types.js";

describe("arivie types", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "arivie-types-"));
    await mkdir(join(cwd, "semantic", "entities"), { recursive: true });
    await writeFile(
      join(cwd, "semantic", "entities", "orders.yml"),
      `name: orders
description: Orders placed by customers.
grain: one row per order
primary_key: id
measures:
  - name: revenue
    description: Total revenue
    sql: SUM(total_amount)
  - name: ticket_count
    description: Ticket count
    sql: COUNT(*)
dimensions:
  - name: status
    sql: status
    values: [pending, completed, refunded]
segments:
  - name: yesterday
    sql: "business_day = (CURRENT_DATE - INTERVAL '1 day')::date"
`,
      "utf8",
    );

    await mkdir(join(cwd, "skills", "daily-recap"), { recursive: true });
    await writeFile(
      join(cwd, "skills", "daily-recap", "SKILL.md"),
      "---\nname: daily-recap\n---\n# Daily recap\n",
      "utf8",
    );
    await mkdir(join(cwd, "skills", "prime-cost"), { recursive: true });
    await writeFile(
      join(cwd, "skills", "prime-cost", "SKILL.md"),
      "---\nname: prime-cost\n---\n# Prime cost\n",
      "utf8",
    );
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("emits a types.ts file with entity, measure, dimension, segment, skill exports", async () => {
    const exit = await runTypesCommand({ cwd });
    expect(exit).toBe(0);

    const out = await readFile(join(cwd, ".arivie", "types.ts"), "utf8");

    // Entity names
    expect(out).toContain("export const entityNames = ['orders'] as const;");
    expect(out).toContain("export type EntityName = (typeof entityNames)[number];");

    // Per-entity narrowed types
    expect(out).toContain("export type OrdersMeasure = 'revenue' | 'ticket_count';");
    expect(out).toContain("export type OrdersDimension = 'status';");
    expect(out).toContain("export type OrdersSegment = 'yesterday';");

    // Master Semantic map
    expect(out).toContain("export interface ArivieSemantic {");
    expect(out).toContain('"orders":');
    expect(out).toMatch(/measures: 'revenue' \| 'ticket_count'/);

    // Skill names (sorted)
    expect(out).toContain(
      "export const skillNames = ['daily-recap', 'prime-cost'] as const;",
    );
    expect(out).toContain("export type SkillName = (typeof skillNames)[number];");
  });

  it("writes never-typed unions when no skills are present", async () => {
    await rm(join(cwd, "skills"), { recursive: true, force: true });
    const exit = await runTypesCommand({ cwd });
    expect(exit).toBe(0);

    const out = await readFile(join(cwd, ".arivie", "types.ts"), "utf8");
    expect(out).toContain("export const skillNames = [] as const;");
    expect(out).toContain("export type SkillName = never;");
  });

  it("respects --out path", async () => {
    const exit = await runTypesCommand({ cwd, out: "./generated/arivie.ts" });
    expect(exit).toBe(0);

    const out = await readFile(join(cwd, "generated", "arivie.ts"), "utf8");
    expect(out).toContain("entityNames");
  });

  it("fails with a clear error when semantic dir is missing", async () => {
    await rm(join(cwd, "semantic"), { recursive: true, force: true });
    const exit = await runTypesCommand({ cwd });
    expect(exit).toBe(1);
  });
});
