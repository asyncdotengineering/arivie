/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it, vi } from "vitest";
const makeMCPSourceAdapter = vi.hoisted(() => vi.fn());

vi.mock("@arivie/source-mcp", () => ({
  makeMCPSourceAdapter,
}));

import { resolveSources } from "../src/sources.js";

describe("resolveSources MCP dispatch", () => {
  it("dynamic-imports @arivie/source-mcp for { mcp } entries", async () => {
    const mcpAdapter = {
      kind: "mcp",
      id: "mcp:mock:abc",
      execute: async () => ({
        rows: [],
        rowCount: 0,
        durationMs: 0,
        truncated: false,
      }),
      introspect: async () => [],
      verifyOwnerIdentity: async () => {},
    };

    const mcpTools = { mock_query: { id: "mock_query" } };
    makeMCPSourceAdapter.mockResolvedValue({
      adapter: mcpAdapter,
      tools: mcpTools,
    });

    const resolved = await resolveSources({
      mock: {
        mcp: { command: "node", args: ["server.js"] },
      },
    });

    expect(makeMCPSourceAdapter).toHaveBeenCalledWith({
      name: "mock",
      serverConfig: { command: "node", args: ["server.js"] },
    });
    expect(resolved.sources.mock).toBe(mcpAdapter);
    expect(resolved.mcpTools).toEqual(mcpTools);
  });

  it("builds an independent adapter per MCP source (multi-MCP composition)", async () => {
    makeMCPSourceAdapter.mockClear();
    const linearAdapter = {
      kind: "mcp",
      id: "mcp:linear:abc",
      execute: async () => ({ rows: [], rowCount: 0, durationMs: 0, truncated: false }),
      introspect: async () => [],
      verifyOwnerIdentity: async () => {},
    };
    const slackAdapter = {
      kind: "mcp",
      id: "mcp:slack:def",
      execute: async () => ({ rows: [], rowCount: 0, durationMs: 0, truncated: false }),
      introspect: async () => [],
      verifyOwnerIdentity: async () => {},
    };

    makeMCPSourceAdapter
      .mockResolvedValueOnce({
        adapter: linearAdapter,
        tools: { linear_list_issues: { id: "linear_list_issues" } },
      })
      .mockResolvedValueOnce({
        adapter: slackAdapter,
        tools: { slack_list_messages: { id: "slack_list_messages" } },
      });

    const resolved = await resolveSources({
      linear: { mcp: { command: "linear-mcp-server" } },
      slack: { mcp: { command: "slack-mcp-server", env: { SLACK_TOKEN: "x" } } },
    });

    expect(makeMCPSourceAdapter).toHaveBeenCalledTimes(2);
    expect(makeMCPSourceAdapter).toHaveBeenCalledWith({
      name: "linear",
      serverConfig: { command: "linear-mcp-server", args: [] },
    });
    expect(makeMCPSourceAdapter).toHaveBeenCalledWith({
      name: "slack",
      serverConfig: { command: "slack-mcp-server", args: [], env: { SLACK_TOKEN: "x" } },
    });
    expect(resolved.sources.linear).toBe(linearAdapter);
    expect(resolved.sources.slack).toBe(slackAdapter);
    expect(resolved.sources.linear.id).not.toBe(resolved.sources.slack.id);
    expect(resolved.mcpTools).toEqual({
      linear_list_issues: { id: "linear_list_issues" },
      slack_list_messages: { id: "slack_list_messages" },
    });
  });
});
