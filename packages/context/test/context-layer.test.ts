/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineContextLayer } from "../src/index.js";
import type { ContextSchemaDefinition } from "../src/schemas.js";

const knowledgeSchema: ContextSchemaDefinition = {
  id: "docs.page",
  kind: "knowledge",
  description: "Prose knowledge page",
};

const outletSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  city: z.string().optional(),
});

const executableSchema: ContextSchemaDefinition = {
  id: "demo.outlet",
  kind: "executable",
  schema: outletSchema,
};

function writeFixture(root: string, relativePath: string, content: string): void {
  const filePath = join(root, relativePath);
  mkdirSync(join(filePath, ".."), { recursive: true });
  writeFileSync(filePath, content, "utf8");
}

describe("defineContextLayer", () => {
  it("loads knowledge and executable documents with provenance", async () => {
    const root = mkdtempSync(join(tmpdir(), "arivie-context-"));
    writeFixture(
      root,
      "docs/guide.md",
      `---
id: getting-started
schema: docs.page
refs:
  - demo-outlet
---
# Getting started

Welcome to the demo.
`,
    );
    writeFixture(
      root,
      "entities/outlet.yml",
      `id: demo-outlet
name: Downtown
city: Austin
`,
    );

    const layer = defineContextLayer({
      root,
      schemas: [knowledgeSchema, executableSchema],
    });

    const result = await layer.load();

    expect(result.issues.filter((issue) => issue.severity === "error")).toEqual([]);

    const knowledge = layer.get("getting-started");
    expect(knowledge).toMatchObject({
      id: "getting-started",
      kind: "knowledge",
      schema: "docs.page",
      path: "docs/guide.md",
      body: "# Getting started\n\nWelcome to the demo.\n",
      refs: ["demo-outlet"],
    });
    expect(knowledge?.provenance?.[0]).toMatchObject({
      validation: "passed",
    });
    expect(knowledge?.provenance?.[0]?.sourceHash).toMatch(/^[a-f0-9]{64}$/);

    const executable = layer.get("demo-outlet");
    expect(executable).toMatchObject({
      id: "demo-outlet",
      kind: "executable",
      schema: "demo.outlet",
      path: "entities/outlet.yml",
      data: { id: "demo-outlet", name: "Downtown", city: "Austin" },
    });
    expect(executable?.provenance?.[0]).toMatchObject({
      validation: "passed",
    });
    expect(executable?.provenance?.[0]?.sourceHash).toMatch(/^[a-f0-9]{64}$/);

    expect(layer.all()).toHaveLength(2);
  });

  it("reports schema validation failures without throwing", async () => {
    const root = mkdtempSync(join(tmpdir(), "arivie-context-"));
    writeFixture(
      root,
      "entities/bad-outlet.yml",
      `name: ""
`,
    );

    const layer = defineContextLayer({
      root,
      schemas: [executableSchema],
    });

    const result = await layer.load();
    const validationIssue = result.issues.find(
      (issue) => issue.severity === "error" && issue.path === "entities/bad-outlet.yml",
    );

    expect(validationIssue).toBeDefined();
    expect(validationIssue?.message.length).toBeGreaterThan(0);

    const document = layer.get("entities/bad-outlet");
    expect(document?.provenance?.[0]).toMatchObject({
      validation: "failed",
    });
  });

  it("populates type from frontmatter with playbook and reference first-class", async () => {
    const root = mkdtempSync(join(tmpdir(), "arivie-context-"));
    writeFixture(
      root,
      "concepts/returns.md",
      `---
id: return-policy
type: playbook
schema: docs.page
---
# Return policy
`,
    );
    writeFixture(
      root,
      "concepts/refund.md",
      `---
id: refund-window
type: reference
schema: docs.page
---
# Refund window
`,
    );
    writeFixture(
      root,
      "concepts/default.md",
      `---
id: default-knowledge
schema: docs.page
---
# Default type
`,
    );

    const layer = defineContextLayer({
      root,
      schemas: [knowledgeSchema],
    });

    const result = await layer.load();

    expect(result.issues.filter((issue) => issue.severity === "error")).toEqual([]);
    expect(layer.get("return-policy")).toMatchObject({ type: "playbook" });
    expect(layer.get("refund-window")).toMatchObject({ type: "reference" });
    expect(layer.get("default-knowledge")).toMatchObject({ type: "knowledge" });
  });

  it("warns on unknown type without rejecting the document", async () => {
    const root = mkdtempSync(join(tmpdir(), "arivie-context-"));
    writeFixture(
      root,
      "concepts/custom.md",
      `---
id: custom-type-doc
type: ontology
schema: docs.page
---
# Custom
`,
    );

    const layer = defineContextLayer({
      root,
      schemas: [knowledgeSchema],
    });

    const result = await layer.load();

    expect(result.issues.filter((issue) => issue.severity === "error")).toEqual([]);
    const warning = result.issues.find(
      (issue) =>
        issue.severity === "warning" &&
        issue.message === 'unknown context type "ontology"',
    );
    expect(warning).toMatchObject({ path: "concepts/custom.md" });
    expect(layer.get("custom-type-doc")).toMatchObject({ type: "ontology" });
  });

  it("reports orphaned references", async () => {
    const root = mkdtempSync(join(tmpdir(), "arivie-context-"));
    writeFixture(
      root,
      "docs/missing-ref.md",
      `---
id: orphan-doc
schema: docs.page
refs:
  - does-not-exist
---
# Orphan
`,
    );

    const layer = defineContextLayer({
      root,
      schemas: [knowledgeSchema],
    });

    const result = await layer.load();
    const orphanIssue = result.issues.find(
      (issue) =>
        issue.severity === "error" &&
        issue.message.includes('Orphaned reference "does-not-exist"'),
    );

    expect(orphanIssue).toMatchObject({
      path: "docs/missing-ref.md",
    });
  });
});
