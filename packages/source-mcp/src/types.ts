/* SPDX-License-Identifier: Apache-2.0 */
import type { MastraMCPServerDefinition } from "@mastra/mcp";
import type { SourceAdapter } from "@arivie/core/types";
import type { Tool } from "@mastra/core/tools";

/** Query shape routed to an underlying MCP tool. */
export interface MCPSourceQuery {
  toolName: string;
  args: Record<string, unknown>;
}

export interface MCPSourceConfig {
  serverConfig: MastraMCPServerDefinition;
  name: string;
}

export interface MCPToolInfo {
  name: string;
  namespacedName: string;
  description?: string;
}

export interface MCPSourceAdapterResult {
  adapter: SourceAdapter<MCPSourceQuery>;
  tools: Record<string, Tool>;
}
