/* SPDX-License-Identifier: Apache-2.0 */
import { makeAgent } from "@arivie/agent";
import { makeWorkspace } from "@arivie/workspace";
import type { Workspace } from "@mastra/core/workspace";
import type { SemanticLayer } from "@arivie/semantic";
import type { PostgresAdapter } from "@arivie/db-postgres";
import { ToolError } from "@arivie/db-postgres";
import type { Agent } from "@mastra/core/agent";
import { MCPServer } from "@mastra/mcp";
import type { LanguageModel } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { makeMcpServer } from "../src/make-server.js";

function sampleSemantic(): SemanticLayer {
  return {
    entities: new Map([
      [
        "orders",
        {
          name: "orders",
          description: "Orders",
          grain: "one row per order",
          primary_key: "id",
          source: { adapter: "postgres", instance: "primary" },
          measures: [],
          dimensions: [],
          segments: [],
          joins: [],
          example_questions: [],
          example_queries: [],
          columns: [],
        },
      ],
    ]),
    catalog: {
      entities: [
        {
          name: "orders",
          description: "Customer orders",
          keywords: ["orders", "revenue"],
        },
      ],
      generated_at: "2026-01-01T00:00:00.000Z",
      source_files: ["entities/orders.yml"],
    },
  };
}

function emptySemantic(): SemanticLayer {
  return {
    entities: new Map(),
    catalog: {
      entities: [],
      generated_at: "2026-01-01T00:00:00.000Z",
      source_files: [],
    },
  };
}

function mockDb(): PostgresAdapter & { execute: ReturnType<typeof vi.fn> } {
  const execute = vi.fn(async () => ({
    rows: [{ n: 1 }],
    rowCount: 1,
    truncated: false,
    durationMs: 1,
  }));
  return {
    kind: "postgres",
    id: "postgres:test",
    url: "postgres://test",
    sql: {} as PostgresAdapter["sql"],
    execute,
    introspect: async () => [],
    verifyOwnerIdentity: async () => {},
    setupRole: async () => {},
  };
}

const stubModel = new MockLanguageModelV3({
  provider: "mock",
  modelId: "mock",
  doGenerate: {
    content: [{ type: "text", text: "42" }],
    finishReason: "stop",
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    warnings: [],
  },
} as unknown as ConstructorParameters<typeof MockLanguageModelV3>[0]) as LanguageModel;

const mcpWorkspaces: Record<string, Workspace> = {};

beforeAll(async () => {
  for (const rootDir of [
    "/tmp/arivie-mcp-test",
    "/tmp/arivie-mcp-ask",
    "/tmp/arivie-mcp-fail",
  ]) {
    const { workspace } = await makeWorkspace({ rootDir });
    mcpWorkspaces[rootDir] = workspace;
  }
});

describe("makeMcpServer", () => {
  function buildServer(overrides?: {
    semantic?: SemanticLayer;
    db?: ReturnType<typeof mockDb>;
    agent?: Agent;
  }) {
    const db = overrides?.db ?? mockDb();
    const agent =
      overrides?.agent ??
      makeAgent({
        ownerId: "test-owner",
        model: stubModel,
        semantic: overrides?.semantic ?? sampleSemantic(),
        contextMode: "preload",
        sources: { postgres: db },
        workspace: mcpWorkspaces["/tmp/arivie-mcp-test"]!,
        limits: {},
        config: { compile_metric: false, workspace: { finalizeReport: true } },
      });
    const server = makeMcpServer({
      agent,
      semantic: overrides?.semantic ?? sampleSemantic(),
      db,
      ownerId: "test-owner",
      ownerName: "Test",
    });
    return { server, agent, db };
  }

  it("returns an MCPServer with metadata", () => {
    const { server } = buildServer();
    expect(server).toBeInstanceOf(MCPServer);
    expect(server.name).toBe("Arivie for Test");
    expect(server.version).toBe("0.0.0");
  });

  it("registers ask, query, schema, memory plus ask_arivie (5 tools)", () => {
    const { server } = buildServer();
    const tools = server.tools();
    expect(Object.keys(tools).sort()).toEqual(
      ["ask", "ask_arivie", "memory", "query", "schema"].sort(),
    );
  });

  it("exposes RFC §4.7 tool descriptions", async () => {
    const { server } = buildServer();
    const list = await server.getToolListInfo();
    const byName = Object.fromEntries(list.tools.map((t) => [t.name, t]));

    expect(byName.ask?.description).toBe(
      "Ask Arivie a question; runs the agent's full conversational round-trip.",
    );
    expect(byName.query?.description).toBe(
      "Execute a read-only SQL query against the owner's database.",
    );
    expect(byName.schema?.description).toBe(
      "Return the semantic-layer catalog + entities for this owner.",
    );
    expect(byName.memory?.description).toBe(
      "Read/write Mastra Memory through the agent's storage. (Sprint 5 wiring; v0.1 returns stub.)",
    );
  });

  it("schema execute returns catalog and entities", async () => {
    const semantic = sampleSemantic();
    const { server } = buildServer({ semantic });
    const result = await server.executeTool("schema", {});
    expect(result.catalog).toEqual(semantic.catalog);
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0]?.name).toBe("orders");
  });

  it("schema with empty semantic still returns structured result", async () => {
    const semantic = emptySemantic();
    const { server } = buildServer({ semantic });
    const result = await server.executeTool("schema", {});
    expect(result).toEqual({
      catalog: semantic.catalog,
      entities: [],
    });
  });

  it("query execute calls db.execute with reader role and limits", async () => {
    const db = mockDb();
    const { server } = buildServer({ db });
    const result = await server.executeTool("query", {
      sql: "SELECT 1",
    });

    expect(db.execute).toHaveBeenCalledWith({
      query: "SELECT 1",
      runAsRole: "arivie_reader",
      userId: "mcp",
      rowLimit: 50,
      timeoutMs: 30_000,
    });
    expect(result).toEqual({
      rows: [{ n: 1 }],
      rowCount: 1,
      sql: "SELECT 1",
    });
  });

  it("query rejects DML via validateExecuteSql", async () => {
    const { server } = buildServer();
    await expect(
      server.executeTool("query", { sql: "DELETE FROM orders" }),
    ).rejects.toSatisfy((err: unknown) => {
      if (err instanceof ToolError) {
        return err.kind === "sql-invalid";
      }
      return (
        err instanceof Error &&
        err.message.includes("only SELECT and WITH statements")
      );
    });
  });

  it("REQ-26: ask execute calls agent.generate on the configured instance", async () => {
    const db = mockDb();
    const agent = makeAgent({
      ownerId: "test-owner",
      model: stubModel,
      semantic: sampleSemantic(),
      contextMode: "preload",
      sources: { postgres: db },
      workspace: mcpWorkspaces["/tmp/arivie-mcp-ask"]!,
      limits: {},
      config: { compile_metric: false, workspace: { finalizeReport: true } },
    });
    const generate = vi.spyOn(agent, "generate").mockResolvedValue({
      text: "answer text",
      toolResults: [{ name: "execute" }],
    } as never);

    const server = makeMcpServer({
      agent,
      semantic: sampleSemantic(),
      db,
      ownerId: "test-owner",
      ownerName: "Test",
    });

    const result = await server.executeTool("ask", { prompt: "revenue?" });
    expect(generate).toHaveBeenCalledWith("revenue?");
    expect(result).toEqual({
      text: "answer text",
      toolResults: [{ name: "execute" }],
    });
  });

  it("ask surfaces agent.generate failures", async () => {
    const db = mockDb();
    const agent = makeAgent({
      ownerId: "test-owner",
      model: stubModel,
      semantic: sampleSemantic(),
      contextMode: "preload",
      sources: { postgres: db },
      workspace: mcpWorkspaces["/tmp/arivie-mcp-fail"]!,
      limits: {},
      config: { compile_metric: false, workspace: { finalizeReport: true } },
    });
    vi.spyOn(agent, "generate").mockRejectedValue(new Error("model down"));

    const server = makeMcpServer({
      agent,
      semantic: sampleSemantic(),
      db,
      ownerId: "test-owner",
      ownerName: "Test",
    });

    await expect(
      server.executeTool("ask", { prompt: "fail" }),
    ).rejects.toThrow("model down");
  });

  it("memory returns Sprint 5 stub shape", async () => {
    const { server } = buildServer();
    const result = await server.executeTool("memory", { action: "list" });
    expect(result).toEqual({
      note: "Memory wiring lands in Sprint 5; Sprint 3 stub returns ok",
    });
  });

  it("memory save action still returns stub (Sprint 5 defers wiring)", async () => {
    const { server } = buildServer();
    const result = await server.executeTool("memory", {
      action: "save",
      key: "correction",
      value: "use net revenue",
    });
    expect(result.note).toContain("Sprint 5");
  });
});
