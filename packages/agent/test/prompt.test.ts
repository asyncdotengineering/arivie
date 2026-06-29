/* SPDX-License-Identifier: Apache-2.0 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Entity, SemanticLayer } from "@arivie/semantic";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  ASSUMPTION_STATING_RULE,
  COMPOSITION_DISCIPLINE,
  buildSystemPrompt,
  buildSystemPromptIndexed,
  FINALIZE_REPORT_RULE,
  governanceCoreSection,
  SELF_CORRECTION_RULES,
  SKILL_DISCIPLINE_EAGER,
  SKILL_DISCIPLINE_ONDEMAND,
  WORKSPACE_NAVIGATION_RULE,
} from "../src/prompt.js";

const fixturePath = join(import.meta.dirname, "fixtures", "sample-layer.json");

interface SampleLayerFixture {
  catalog: SemanticLayer["catalog"];
  entities: Entity[];
}

async function loadFixture(): Promise<SemanticLayer> {
  const raw = await readFile(fixturePath, "utf8");
  const fixture = JSON.parse(raw) as SampleLayerFixture;
  return {
    catalog: fixture.catalog,
    entities: new Map(fixture.entities.map((entity) => [entity.name, entity])),
  };
}

beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-06-15T12:00:00Z")); });
afterAll(() => { vi.useRealTimers(); });

describe("governanceCoreSection", () => {
  it("renders a byte-stable catalog, join skeleton, and glossary without entity detail", () => {
    const semantic: SemanticLayer = {
      catalog: {
        entities: [
          { name: "orders", description: "Orders.", keywords: ["sales"] },
          { name: "customers", description: "Customers.", keywords: ["buyers"] },
        ],
        glossary: [
          { term: "revenue", status: "ambiguous", definition: "Gross or net sales." },
          { term: "AOV", status: "defined", definition: "Average order value." },
        ],
        generated_at: "2026-06-29T12:34:56.000Z",
        source_files: ["entities/orders.yml", "entities/customers.yml"],
      },
      entities: new Map([
        [
          "orders",
          {
            name: "orders",
            description: "Orders.",
            grain: "one row per order",
            primary_key: "id",
            measures: [{ name: "revenue", description: "Revenue.", sql: "SUM(total)" }],
            dimensions: [{ name: "status", sql: "status", type: "text", sample_values: ["paid"] }],
            joins: [
              { to: "customers", on: "orders.customer_id = customers.id" },
              { to: "customers", on: "orders.billing_customer_id = customers.id" },
            ],
          } as Entity,
        ],
        [
          "customers",
          {
            name: "customers",
            description: "Customers.",
            grain: "one row per customer",
            primary_key: "id",
          },
        ],
      ]),
    };

    const first = governanceCoreSection(semantic);
    const second = governanceCoreSection(semantic);

    expect(first).toBe(second);
    expect(first).toContain("## Semantic catalog");
    expect(first.indexOf("**customers**:")).toBeLessThan(first.indexOf("**orders**:"));
    expect(first).toContain("- **customers** joins: none");
    expect(first).toContain("- **orders** joins: customers");
    expect(first).toContain("## Glossary");
    expect(first).toContain("**AOV** — Average order value.");
    expect(first).toContain("**revenue** — Gross or net sales.");
    expect(first).not.toContain("2026-06-29");
    expect(first).not.toContain("Measures:");
    expect(first).not.toContain("Dimensions:");
    expect(first).not.toContain("sample_values");
    expect(first).not.toContain("SUM(total)");
    expect(first).not.toContain("orders.customer_id = customers.id");
  });

  it("renders an empty catalog without throwing", () => {
    const semantic: SemanticLayer = {
      catalog: {
        entities: [],
        generated_at: "2026-06-29T12:34:56.000Z",
        source_files: [],
      },
      entities: new Map(),
    };

    expect(governanceCoreSection(semantic)).toBe(
      "## Semantic catalog\n\n### Catalog",
    );
  });
});

describe("buildSystemPromptIndexed", () => {
  it("includes WORKSPACE_NAVIGATION_RULE and per-source execute tools", () => {
    const prompt = buildSystemPromptIndexed({
      compileMetricEnabled: false,
      sources: [
        { name: "postgres", description: "Demo postgres source." },
        { name: "mixpanel", description: "Demo mixpanel source." },
      ],
      hasFinalizeReport: false,
    });

    expect(prompt).toContain("## WORKSPACE_NAVIGATION_RULE");
    expect(prompt).toContain(WORKSPACE_NAVIGATION_RULE);
    expect(prompt).toContain('mastra_workspace_list_files("./entities")');
    expect(prompt).toContain(
      'mastra_workspace_read_file("./entities/<name>.yml")',
    );
    expect(prompt).toContain("mastra_workspace_search");
    expect(prompt).toContain("execute_postgres");
    expect(prompt).toContain("execute_mixpanel");
    expect(prompt).not.toContain("finalize_report");
  });

  it("includes compile_metric and finalize_report sections when enabled", () => {
    const prompt = buildSystemPromptIndexed({
      compileMetricEnabled: true,
      sources: [{ name: "postgres", description: "Demo postgres source." }],
      hasFinalizeReport: true,
    });

    expect(prompt).toContain("## compile_metric tool");
    expect(prompt).toContain("execute_postgres");
    expect(prompt).toContain(FINALIZE_REPORT_RULE);
    expect(prompt).toMatchSnapshot();
  });
});

describe("buildSystemPrompt", () => {
  it("embeds REQ-11 self-correction and REQ-12 assumption rule verbatim", async () => {
    const semantic = await loadFixture();
    const prompt = buildSystemPrompt({
      mode: "indexed",
      semantic,
      compileMetricEnabled: false,
    });

    expect(prompt).toContain(ASSUMPTION_STATING_RULE);
    expect(prompt).toContain("Zero rows:");
    expect(prompt).toContain(SELF_CORRECTION_RULES);
    expect(prompt).toContain("## WORKSPACE_NAVIGATION_RULE");
    expect(prompt).toContain(WORKSPACE_NAVIGATION_RULE);
    expect(prompt).toContain('mastra_workspace_list_files("./entities")');
    expect(prompt).not.toContain("### explore");
  });

  it("preload mode snapshot includes flattened semantic layer", async () => {
    const semantic = await loadFixture();
    const prompt = buildSystemPrompt({
      mode: "preload",
      semantic,
      compileMetricEnabled: false,
    });

    expect(prompt).toMatch(/^You are Arivie, a single-tenant data analytics agent/);
    expect(prompt).toContain("### Catalog");
    expect(prompt).toContain("### Entity: customers");
    expect(prompt).toContain("### Entity: orders");
    expect(prompt).toContain("revenue");
    expect(prompt).toContain("current_quarter");
    // v0.1.x: preload mode now also enumerates workspace tools so the
    // agent knows it can read skill references / grep semantic dir /
    // write scratch files. The semantic layer is still flattened into
    // the prompt (no NAVIGATION_RULE required for entity discovery).
    expect(prompt).toContain("mastra_workspace_list_files");
    expect(prompt).toContain("mastra_workspace_read_file");
    expect(prompt).toContain("mastra_workspace_grep");
    expect(prompt).not.toContain(WORKSPACE_NAVIGATION_RULE);
    expect(prompt).toMatchSnapshot();
  });

  it("indexed mode snapshot omits entity bodies and teaches workspace tools", async () => {
    const semantic = await loadFixture();
    const prompt = buildSystemPrompt({
      mode: "indexed",
      semantic,
      compileMetricEnabled: false,
    });

    expect(prompt).toContain("mastra_workspace_list_files");
    expect(prompt).toContain(WORKSPACE_NAVIGATION_RULE);
    expect(prompt).not.toContain("### Entity: orders");
    expect(prompt).not.toContain("### Catalog");
    expect(prompt).toMatchSnapshot();
  });

  it("preload mode renders entity hints under ### Hints (entityName)", () => {
    const semantic: SemanticLayer = {
      catalog: {
        entities: [
          {
            name: "foo",
            description: "Fixture entity with hints.",
            keywords: ["foo"],
          },
        ],
        generated_at: "2026-05-20T00:00:00.000Z",
        source_files: ["entities/foo.yml"],
      },
      entities: new Map([
        [
          "foo",
          {
            name: "foo",
            description: "Fixture entity with hints.",
            grain: "one row per foo",
            primary_key: "id",
            hints: ["Use X for Y.", "Z is always Q."],
          },
        ],
      ]),
    };

    const prompt = buildSystemPrompt({
      mode: "preload",
      semantic,
      compileMetricEnabled: false,
    });

    expect(prompt).toContain("### Hints (foo)");
    expect(prompt).toContain("- Use X for Y.");
    expect(prompt).toMatchSnapshot();
  });

  it("includes compile_metric paragraph when enabled", async () => {
    const semantic = await loadFixture();
    const prompt = buildSystemPrompt({
      mode: "preload",
      semantic,
      compileMetricEnabled: true,
    });

    expect(prompt).toContain("## compile_metric tool");
    expect(prompt).toMatchSnapshot();
  });

  it("renders SKILL_DISCIPLINE_EAGER when skillsMode is eager", async () => {
    const semantic = await loadFixture();
    const prompt = buildSystemPrompt({
      mode: "preload",
      semantic,
      compileMetricEnabled: false,
      skillsMode: "eager",
    });

    expect(prompt).toContain("## Skill discipline");
    expect(prompt).toContain(SKILL_DISCIPLINE_EAGER);
    expect(prompt).not.toContain(SKILL_DISCIPLINE_ONDEMAND);
  });

  it("renders SKILL_DISCIPLINE_ONDEMAND when skillsMode is on-demand", async () => {
    const semantic = await loadFixture();
    const prompt = buildSystemPrompt({
      mode: "preload",
      semantic,
      compileMetricEnabled: false,
      skillsMode: "on-demand",
    });

    expect(prompt).toContain("## Skill discipline");
    expect(prompt).toContain(SKILL_DISCIPLINE_ONDEMAND);
    expect(prompt).toContain("search_skills");
    expect(prompt).toContain("load_skill");
    expect(prompt).not.toContain(SKILL_DISCIPLINE_EAGER);
  });

  it("omits skill discipline when skillsMode is none (default)", async () => {
    const semantic = await loadFixture();
    const prompt = buildSystemPrompt({
      mode: "preload",
      semantic,
      compileMetricEnabled: false,
    });

    expect(prompt).not.toContain("## Skill discipline");
    expect(prompt).not.toContain(SKILL_DISCIPLINE_EAGER);
    expect(prompt).not.toContain(SKILL_DISCIPLINE_ONDEMAND);
  });

  it("renders skill discipline before Reasoning section", async () => {
    const semantic = await loadFixture();
    const prompt = buildSystemPrompt({
      mode: "preload",
      semantic,
      compileMetricEnabled: false,
      skillsMode: "on-demand",
    });

    const skillIdx = prompt.indexOf("## Skill discipline");
    const reasoningIdx = prompt.indexOf("## Reasoning");
    expect(skillIdx).toBeGreaterThan(-1);
    expect(reasoningIdx).toBeGreaterThan(-1);
    expect(skillIdx).toBeLessThan(reasoningIdx);
  });
});

describe("buildSystemPrompt — glossary (ADR 0004)", () => {
  function layerWithGlossary(): SemanticLayer {
    return {
      entities: new Map(),
      catalog: {
        entities: [],
        glossary: [
          { term: "revenue", status: "ambiguous", definition: "gross vs net vs GL" },
          { term: "AOV", status: "defined", definition: "average order value" },
        ],
        generated_at: "2026-01-01T00:00:00Z",
        source_files: [],
      },
    };
  }

  it("renders defined terms and a hard CLARIFY rule for ambiguous terms", () => {
    const prompt = buildSystemPrompt({
      mode: "preload",
      semantic: layerWithGlossary(),
      compileMetricEnabled: true,
      sources: [],
      skillsMode: "none",
    });
    expect(prompt).toContain("## Glossary");
    expect(prompt).toContain("**AOV** — average order value");
    expect(prompt).toMatch(/AMBIGUOUS:\s*`revenue`/);
    expect(prompt).toMatch(/ask ONE short clarifying question/i);
    // clarify ONCE, then act — the rule must have an exit (no re-clarify loop).
    expect(prompt).toMatch(/clarify ONCE, then act/i);
    expect(prompt).toMatch(/Do NOT ask a second clarifying question/i);
    expect(prompt).toMatch(/Never loop/i);
  });

  it("omits the glossary section when no glossary is present", () => {
    const layer: SemanticLayer = {
      entities: new Map(),
      catalog: { entities: [], generated_at: "x", source_files: [] },
    };
    const prompt = buildSystemPrompt({ mode: "preload", semantic: layer, compileMetricEnabled: true, sources: [], skillsMode: "none" });
    expect(prompt).not.toContain("## Glossary");
  });
});

describe("buildSystemPrompt — sample_values + canonical query patterns (ADR 0004)", () => {
  it("renders dimension sample_values (grounds WHERE filters) distinct from values", () => {
    const layer: SemanticLayer = {
      entities: new Map([
        ["customers", {
          name: "customers", description: "x", grain: "one row per customer", primary_key: "id",
          dimensions: [
            { name: "name", sql: "name", type: "text", sample_values: ["Acme", "Globex"] },
            { name: "plan", sql: "plan", type: "text", values: ["free", "pro"] },
          ],
        } as unknown as Entity],
      ]),
      catalog: { entities: [], generated_at: "x", source_files: [] },
    };
    const p = buildSystemPrompt({ mode: "preload", semantic: layer, compileMetricEnabled: true, sources: [], skillsMode: "none" });
    expect(p).toMatch(/e\.g\. Acme, Globex/);   // sample_values
    expect(p).toMatch(/values: free, pro/);      // enum still rendered
  });

  it("frames example_queries as canonical query patterns to reuse", () => {
    const layer: SemanticLayer = {
      entities: new Map([
        ["orders", {
          name: "orders", description: "x", grain: "one row per order", primary_key: "id",
          example_queries: [{ question: "revenue by month?", sql: "SELECT 1" }],
        } as unknown as Entity],
      ]),
      catalog: { entities: [], generated_at: "x", source_files: [] },
    };
    const p = buildSystemPrompt({ mode: "preload", semantic: layer, compileMetricEnabled: true, sources: [], skillsMode: "none" });
    expect(p).toMatch(/Canonical query patterns/);
  });
});

describe("buildSystemPrompt — measure objective / ranking (ADR 0004)", () => {
  function layerWithObjective(withObjective: boolean): SemanticLayer {
    return {
      entities: new Map([
        ["orders", {
          name: "orders", description: "x", grain: "one row per order", primary_key: "id",
          measures: [
            { name: "revenue", description: "rev", sql: "SUM(x)", ...(withObjective ? { objective: "maximize" as const } : {}) },
            { name: "refunds", description: "ref", sql: "SUM(y)", ...(withObjective ? { objective: "minimize" as const } : {}) },
          ],
        } as unknown as Entity],
      ]),
      catalog: { entities: [], generated_at: "x", source_files: [] },
    };
  }
  it("renders objective on the measure + the ranking rule when declared", () => {
    const p = buildSystemPrompt({ mode: "preload", semantic: layerWithObjective(true), compileMetricEnabled: true, sources: [], skillsMode: "none" });
    expect(p).toMatch(/objective: minimize/);
    expect(p).toMatch(/## Ranking/);
    expect(p).toMatch(/best = LOWEST/);
  });
  it("omits the ranking rule when no measure declares an objective", () => {
    const p = buildSystemPrompt({ mode: "preload", semantic: layerWithObjective(false), compileMetricEnabled: true, sources: [], skillsMode: "none" });
    expect(p).not.toMatch(/## Ranking/);
  });
});

describe("buildSystemPrompt — temporal grounding", () => {
  it("injects the current time so the agent can resolve relative dates", () => {
    const layer = { entities: new Map(), catalog: { entities: [], generated_at: "x", source_files: [] } } as unknown as SemanticLayer;
    const p = buildSystemPrompt({ mode: "preload", semantic: layer, compileMetricEnabled: true, sources: [], skillsMode: "none" });
    expect(p).toContain("## Current time");
    expect(p).toMatch(/today is 2026-06-15/); // frozen clock
    expect(p).toMatch(/relative dates/i);
  });
});

describe("buildSystemPrompt — composition & exploration", () => {
  it("frames the semantic layer as building blocks and encourages composing over refusing", () => {
    const layer = { entities: new Map(), catalog: { entities: [], generated_at: "x", source_files: [] } } as unknown as SemanticLayer;
    const p = buildSystemPrompt({ mode: "preload", semantic: layer, compileMetricEnabled: true, sources: [], skillsMode: "none" });
    expect(p).toContain("## Composition & exploration");
    expect(p).toContain(COMPOSITION_DISCIPLINE);
    expect(p).toMatch(/BUILDING BLOCKS, not a menu/);
    expect(p).toMatch(/Before concluding the data can't answer, TRY/);
  });
});
