/* SPDX-License-Identifier: Apache-2.0 */
import type { MCPServer } from "@mastra/mcp";

/**
 * Starts the MCP server on stdin/stdout using Mastra's transport framing.
 * Resolves when the stdio loop ends (per {@link MCPServer.startStdio}).
 */
export async function startStdioServer(opts: { mcp: MCPServer }): Promise<void> {
  await opts.mcp.startStdio();
}
