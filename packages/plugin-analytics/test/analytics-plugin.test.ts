/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SourceAdapter } from "@arivie/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { analytics, type AnalyticsPluginConfig } from "../src/index.js";

type FakePostgresSource = SourceAdapter<unknown> & {
  readonly kind: "postgres";
  readonly url: string;
  readonly sql: unknown;
  setupRole(role: string, options?: { allowedTables?: string[] }): Promise<void>;
};

const tempRoots: string[] = [];

async function makeSemanticRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "arivie-plugin-analytics-"));
  tempRoots.push(root);
  const entities = join(root, "entities");
  await mkdir(entities);
  await writeFile(
    join(entities, "orders.yml"),
    [
      "name: orders",
      "description: Customer orders.",
      "grain: one row per order",
      "primary_key: id",
      "measures:",
      "  - name: revenue",
      "    description: Total order revenue.",
      "    sql: SUM(total)",
      "dimensions:",
      "  - name: id",
      "    sql: id",
      "    type: text",
    ].join("\n"),
  );
  return root;
}

function fakePostgresSource(): FakePostgresSource {
  return {
    kind: "postgres",
    id: "postgres:warehouse",
    url: "postgres://warehouse",
    sql: {},
    execute: vi.fn().mockResolvedValue({
      rows: [],
      rowCount: 0,
      durationMs: 0,
      truncated: false,
    }),
    introspect: vi.fn().mockResolvedValue([]),
    verifyOwnerIdentity: vi.fn().mockResolvedValue(undefined),
    setupRole: vi.fn().mockResolvedValue(undefined),
  };
}

afterEach(async () => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root != null) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

describe("@arivie/plugin-analytics", () => {
  it("declares analytics metadata and contributes tools plus instructions", async () => {
    const semanticPath = await makeSemanticRoot();
    const config: AnalyticsPluginConfig = {
      semanticPath,
      sources: { warehouse: fakePostgresSource() },
      compileMetric: true,
      mode: "preload",
    };

    const { definition } = analytics(config);

    expect(definition.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "analytics.query" }),
        expect.objectContaining({ id: "analytics.compile_metric" }),
      ]),
    );
    expect(definition.contextSchemas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "analytics.entity",
          kind: "executable",
          schema: expect.any(Object),
        }),
      ]),
    );

    const contribution = await definition.setup?.({
      config,
      app: { id: "t", name: "t" },
      permissions: new Set(["analytics.sql.read", "database.read"]),
    });

    expect(contribution?.tools).toHaveProperty("execute_warehouse");
    expect(contribution?.tools).toHaveProperty("compile_metric");
    expect(contribution?.instructions).toEqual(expect.any(String));
    expect(contribution?.instructions).not.toHaveLength(0);
  });
});
