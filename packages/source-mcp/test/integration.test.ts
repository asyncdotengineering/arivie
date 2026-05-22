/* SPDX-License-Identifier: Apache-2.0 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeMCPSourceAdapter } from "../src/adapter.js";
import { namespaceToolName } from "../src/namespace.js";

const mockServerPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures/mock-server.ts",
);

describe("makeMCPSourceAdapter integration (mock stdio MCP server)", () => {
  it("discovers namespaced tools and routes execute to each MCP tool", async () => {
    const { adapter, tools } = await makeMCPSourceAdapter({
      name: "mock",
      serverConfig: {
        command: "tsx",
        args: [mockServerPath],
      },
    });

    expect(adapter.kind).toBe("mcp");
    expect(Object.keys(tools).sort()).toEqual([
      "mock_count",
      "mock_introspect",
      "mock_query",
    ]);

    const introspected = await adapter.introspect();
    expect(introspected.map((t) => t.namespacedName).sort()).toEqual([
      "mock_count",
      "mock_introspect",
      "mock_query",
    ]);

    for (const toolName of [
      "mock_query",
      "mock_introspect",
      "mock_count",
    ] as const) {
      const namespaced = namespaceToolName("mock", toolName);
      expect(tools[namespaced]).toBeDefined();
      expect(tools[namespaced]?.execute).toBeTypeOf("function");

      const viaTool = await tools[namespaced]!.execute!({}, {});
      expect(viaTool).toMatchObject({
        rows: [{ tool: toolName, ok: true }],
        rowCount: 1,
      });

      const viaAdapter = await adapter.execute({
        query: { toolName, args: {} },
        userId: "test-user",
        rowLimit: 100,
        timeoutMs: 30_000,
      });
      expect(viaAdapter.rows).toEqual([{ tool: toolName, ok: true }]);
      expect(viaAdapter.rowCount).toBe(1);
      expect(viaAdapter.truncated).toBe(false);
    }

    await adapter.close();
  }, 60_000);
});
