/* SPDX-License-Identifier: Apache-2.0 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const TOOL_NAMES = ["mock_query", "mock_introspect", "mock_count"] as const;

function toolResult(tool: string) {
  return {
    rows: [{ tool, ok: true }],
    rowCount: 1,
    durationMs: 0,
    truncated: false,
  };
}

const server = new McpServer({ name: "arivie-mock-mcp", version: "1.0.0" });

for (const name of TOOL_NAMES) {
  server.registerTool(
    name,
    { description: `Mock tool ${name}` },
    async () => ({
      structuredContent: toolResult(name),
    }),
  );
}

const transport = new StdioServerTransport();
await server.connect(transport);
