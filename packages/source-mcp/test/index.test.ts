/* SPDX-License-Identifier: Apache-2.0 */
import type { SourceAdapter } from "@arivie/core/types";
import type { Tool } from "@mastra/core/tools";
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  deriveMCPAdapterId,
  hashServerConfig,
  makeMCPSourceAdapter,
} from "../src/adapter.js";
import { namespaceToolName } from "../src/namespace.js";
import type { MCPSourceQuery } from "../src/types.js";

const { mockListToolsets, MockMCPClient } = vi.hoisted(() => {
  const mockListToolsets = vi.fn();
  class MockMCPClient {
    listToolsets = mockListToolsets;
    disconnect = vi.fn();
    constructor(_opts: unknown) {}
  }
  return { mockListToolsets, MockMCPClient };
});

vi.mock("@mastra/mcp", () => ({
  MCPClient: MockMCPClient,
}));

function makeMockTool(name: string): Tool {
  return {
    id: `mock_${name}`,
    description: `Mock ${name}`,
    execute: vi.fn().mockResolvedValue({
      rows: [{ tool: name }],
      rowCount: 1,
      durationMs: 2,
      truncated: false,
    }),
  } as unknown as Tool;
}

describe("namespaceToolName", () => {
  it("prefixes tool names with source name", () => {
    expect(namespaceToolName("mixpanel", "query")).toBe("mixpanel_query");
  });

  it("avoids double-prefix when tool already namespaced", () => {
    expect(namespaceToolName("mixpanel", "mixpanel_query")).toBe(
      "mixpanel_query",
    );
  });
});

describe("hashServerConfig", () => {
  it("excludes env from the digest", () => {
    const base = {
      command: "node",
      args: ["server.js"],
    };
    const withSecret = {
      ...base,
      env: { API_KEY: "super-secret" },
    };
    expect(hashServerConfig("src", base)).toBe(
      hashServerConfig("src", withSecret),
    );
  });

  it("includes url in digest for HTTP servers", () => {
    const stdio = hashServerConfig("s", { command: "node", args: [] });
    const http = hashServerConfig("s", {
      url: new URL("http://localhost:8080/mcp"),
    });
    expect(stdio).not.toBe(http);
  });

  it("changes when non-env connection fields change", () => {
    const a = hashServerConfig("src", { command: "node", args: ["a.js"] });
    const b = hashServerConfig("src", { command: "node", args: ["b.js"] });
    expect(a).not.toBe(b);
  });
});

describe("makeMCPSourceAdapter", () => {
  beforeEach(() => {
    mockListToolsets.mockReset();
  });

  it("returns adapter with kind mcp and credential-safe id", async () => {
    mockListToolsets.mockResolvedValue({
      mock: {
        mock_query: makeMockTool("mock_query"),
        mixpanel_query: makeMockTool("mixpanel_query"),
      },
    });

    const { adapter } = await makeMCPSourceAdapter({
      name: "mock",
      serverConfig: { command: "tsx", args: ["fixture.ts"] },
    });

    expect(adapter.kind).toBe("mcp");
    expect(adapter.id).toMatch(/^mcp:mock:[a-f0-9]{12}$/);
    expect(adapter.id).not.toContain("secret");
    expect(adapter.compileMetric).toBeUndefined();
  });

  it("namespaces tools and handles prefix collision", async () => {
    mockListToolsets.mockResolvedValue({
      mixpanel: {
        events: makeMockTool("events"),
        mixpanel_query: makeMockTool("mixpanel_query"),
      },
    });

    const { tools } = await makeMCPSourceAdapter({
      name: "mixpanel",
      serverConfig: { command: "node", args: ["srv.js"] },
    });

    expect(Object.keys(tools).sort()).toEqual([
      "mixpanel_events",
      "mixpanel_query",
    ]);
  });

  it("execute returns empty rows for nullish tool results", async () => {
    const mockTool = {
      id: "t",
      description: "t",
      execute: vi.fn().mockResolvedValue(null),
    } as unknown as Tool;
    mockListToolsets.mockResolvedValue({ mock: { empty: mockTool } });

    const { adapter } = await makeMCPSourceAdapter({
      name: "mock",
      serverConfig: { command: "tsx", args: ["fixture.ts"] },
    });

    const result = await adapter.execute({
      query: { toolName: "empty", args: {} },
      userId: "u1",
      rowLimit: 100,
      timeoutMs: 5000,
    });
    expect(result.rows).toEqual([]);
    expect(result.rowCount).toBe(0);
  });

  it("execute wraps non-rows object results as a single row", async () => {
    const mockTool = {
      id: "t",
      description: "t",
      execute: vi.fn().mockResolvedValue({ value: 42 }),
    } as unknown as Tool;
    mockListToolsets.mockResolvedValue({ mock: { plain: mockTool } });

    const { adapter } = await makeMCPSourceAdapter({
      name: "mock",
      serverConfig: { command: "tsx", args: ["fixture.ts"] },
    });

    const result = await adapter.execute({
      query: { toolName: "plain", args: {} },
      userId: "u1",
      rowLimit: 100,
      timeoutMs: 5000,
    });
    expect(result.rows).toEqual([{ value: 42 }]);
    expect(result.rowCount).toBe(1);
  });

  it("execute truncates rows when rowLimit is exceeded", async () => {
    const mockTool = {
      id: "t",
      description: "t",
      execute: vi.fn().mockResolvedValue({
        rows: [{ n: 1 }, { n: 2 }, { n: 3 }],
        rowCount: 3,
        durationMs: 1,
        truncated: false,
      }),
    } as unknown as Tool;
    mockListToolsets.mockResolvedValue({ mock: { many: mockTool } });

    const { adapter } = await makeMCPSourceAdapter({
      name: "mock",
      serverConfig: { command: "tsx", args: ["fixture.ts"] },
    });

    const result = await adapter.execute({
      query: { toolName: "many", args: {} },
      userId: "u1",
      rowLimit: 2,
      timeoutMs: 5000,
    });
    expect(result.rows).toHaveLength(2);
    expect(result.rowCount).toBe(2);
    expect(result.truncated).toBe(true);
  });

  it("execute throws when tool is missing", async () => {
    mockListToolsets.mockResolvedValue({ mock: {} });
    const { adapter } = await makeMCPSourceAdapter({
      name: "mock",
      serverConfig: { command: "tsx", args: ["fixture.ts"] },
    });
    await expect(
      adapter.execute({
        query: { toolName: "missing", args: {} },
        userId: "u1",
        rowLimit: 10,
        timeoutMs: 5000,
      }),
    ).rejects.toThrow("MCP tool not found: missing");
  });

  it("execute routes to underlying MCP tool and normalizes rows", async () => {
    const mockTool = makeMockTool("mock_query");
    mockListToolsets.mockResolvedValue({
      mock: { mock_query: mockTool },
    });

    const { adapter } = await makeMCPSourceAdapter({
      name: "mock",
      serverConfig: { command: "tsx", args: ["fixture.ts"] },
    });

    const _typed: SourceAdapter<MCPSourceQuery> = adapter;
    void _typed;

    const result = await adapter.execute({
      query: { toolName: "mock_query", args: { q: "users" } },
      userId: "u1",
      rowLimit: 100,
      timeoutMs: 5000,
    });

    expect(mockTool.execute).toHaveBeenCalledWith(
      { q: "users" },
      expect.objectContaining({
        observe: expect.objectContaining({
          log: expect.any(Function),
          span: expect.any(Function),
        }),
      }),
    );
    expect(result.rows).toEqual([{ tool: "mock_query" }]);
    expect(result.rowCount).toBe(1);
    expect(result.truncated).toBe(false);
  });

  it("introspect returns cached tool list", async () => {
    mockListToolsets.mockResolvedValue({
      mock: { mock_count: makeMockTool("mock_count") },
    });

    const { adapter } = await makeMCPSourceAdapter({
      name: "mock",
      serverConfig: { command: "tsx", args: ["fixture.ts"] },
    });

    const tools = await adapter.introspect();
    expect(tools).toEqual([
      {
        name: "mock_count",
        namespacedName: "mock_count",
        description: "Mock mock_count",
      },
    ]);
  });

  it("verifyOwnerIdentity is a no-op", async () => {
    mockListToolsets.mockResolvedValue({ mock: {} });
    const { adapter } = await makeMCPSourceAdapter({
      name: "mock",
      serverConfig: { command: "tsx", args: ["fixture.ts"] },
    });
    await expect(adapter.verifyOwnerIdentity("owner-1")).resolves.toBeUndefined();
  });

  it("deriveMCPAdapterId matches adapter.id shape", () => {
    const id = deriveMCPAdapterId("mock", {
      command: "tsx",
      args: ["x.ts"],
      env: { TOKEN: "x" },
    });
    expect(id).toMatch(/^mcp:mock:[a-f0-9]{12}$/);
  });
});
