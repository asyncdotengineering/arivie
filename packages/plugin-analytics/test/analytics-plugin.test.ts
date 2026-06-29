/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@mastra/core/agent";
import { InMemoryStore } from "@mastra/core/storage";
import {
  assembleAgentContext,
  defineAgent,
  defineArivie,
  InMemoryRuntimeStorage,
  type SourceAdapter,
  wrapInstructionsForCache,
} from "@arivie/core";
import { MockLanguageModelV3 } from "ai/test";
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

function stubModel(): MockLanguageModelV3 {
  return new MockLanguageModelV3({ provider: "mock", modelId: "mock" });
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
  it("contributes a workspace rooted at semanticPath so mastra_workspace_list_files resolves against the semantic directory", async () => {
    const semanticPath = await makeSemanticRoot();
    const config: AnalyticsPluginConfig = {
      semanticPath,
      sources: { warehouse: fakePostgresSource() },
    };

    const { definition } = analytics(config);
    const contribution = await definition.setup?.({
      config,
      app: { id: "t", name: "t" },
      permissions: new Set(["analytics.sql.read"]),
    });

    expect(contribution?.workspace).toBeDefined();

    // The workspace filesystem is rooted at semanticPath: listing the entities
    // sub-directory returns the seeded orders.yml file — confirming that
    // mastra_workspace_list_files (which calls workspace.filesystem.readdir)
    // resolves against the semantic directory.
    const entries = await contribution?.workspace?.filesystem.readdir("entities");
    expect(entries).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "orders.yml", type: "file" })]),
    );
  });

  it("declares analytics metadata and contributes tools plus instructions", async () => {
    const semanticPath = await makeSemanticRoot();
    const config: AnalyticsPluginConfig = {
      semanticPath,
      sources: { warehouse: fakePostgresSource() },
      compileMetric: true,
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
    expect(contribution?.instructions).toContain("## Semantic catalog");
    expect(contribution?.instructions).toContain("## WORKSPACE_NAVIGATION_RULE");
    expect(contribution?.instructions).toContain("mastra_workspace_read_file");
    expect(contribution?.instructions).not.toContain("### Entity: orders");
    expect(contribution?.instructions).not.toContain("Total order revenue");
  });

  it("defineArivie wires analytics workspace so mastra_workspace_list_files lists entities/orders.yml", async () => {
    const semanticPath = await makeSemanticRoot();
    const config: AnalyticsPluginConfig = {
      semanticPath,
      sources: { warehouse: fakePostgresSource() },
    };
    const agentDef = defineAgent({
      instructions: "Answer from the semantic layer.",
      capabilities: ["analytics.query"],
    });
    const model = stubModel();

    const app = await defineArivie({
      app: { id: "t", name: "t" },
      model,
      storage: new InMemoryRuntimeStorage(),
      memory: new InMemoryStore(),
      plugins: [analytics(config)],
      agents: { analyst: agentDef },
      resolveUser: async () => ({ userId: "u1", permissions: ["analytics.sql.read"] }),
    });

    const assembled = assembleAgentContext("analyst", agentDef, app.manifest, []);
    expect(assembled.workspace).toBeDefined();

    const analyticsWorkspace = app.manifest.workspaces.find((ref) => ref.pluginId === "analytics");
    expect(analyticsWorkspace?.value).toBeDefined();

    const agent = new Agent({
      id: "analyst",
      name: "analyst",
      model,
      instructions: wrapInstructionsForCache(assembled.instructions, model),
      tools: assembled.tools,
      workspace: assembled.workspace,
    });

    const tools = await agent.getToolsForExecution({});
    expect(tools).toHaveProperty("mastra_workspace_list_files");

    const listFiles = tools.mastra_workspace_list_files;
    expect(listFiles.execute).toBeTypeOf("function");
    const listing = await listFiles.execute(
      { path: "./entities" },
      { agentId: "analyst", runId: "test-run" },
    );
    expect(typeof listing).toBe("string");
    expect(listing).toContain("orders.yml");

    await app.dispose();
  });
});
