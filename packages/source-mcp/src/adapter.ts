/* SPDX-License-Identifier: Apache-2.0 */
import { createHash } from "node:crypto";
import type {
  SourceAdapter,
  SourceAdapterExecuteOpts,
  SourceAdapterExecuteResult,
} from "@arivie/core/types";
import { MCPClient, type MastraMCPServerDefinition } from "@mastra/mcp";
import type { Tool } from "@mastra/core/tools";
import { namespaceToolName } from "./namespace.js";
import type {
  MCPToolInfo,
  MCPSourceAdapterResult,
  MCPSourceConfig,
  MCPSourceQuery,
} from "./types.js";

/** Credential-safe digest of server config (env values excluded). */
export function hashServerConfig(
  name: string,
  config: MastraMCPServerDefinition,
): string {
  const sanitized = {
    name,
    command: "command" in config ? config.command : undefined,
    args: "args" in config ? config.args : undefined,
    url: "url" in config && config.url ? config.url.toString() : undefined,
    cwd: "cwd" in config ? config.cwd : undefined,
  };
  return createHash("sha256")
    .update(JSON.stringify(sanitized))
    .digest("hex")
    .slice(0, 12);
}

export function deriveMCPAdapterId(
  name: string,
  config: MastraMCPServerDefinition,
): string {
  return `mcp:${name}:${hashServerConfig(name, config)}`;
}

function normalizeToolResult(
  result: unknown,
  durationMs: number,
): SourceAdapterExecuteResult<Record<string, unknown>> {
  if (result && typeof result === "object") {
    const record = result as Record<string, unknown>;
    if (Array.isArray(record.rows)) {
      const rows = record.rows as Record<string, unknown>[];
      return {
        rows,
        rowCount:
          typeof record.rowCount === "number" ? record.rowCount : rows.length,
        durationMs:
          typeof record.durationMs === "number" ? record.durationMs : durationMs,
        truncated: Boolean(record.truncated),
      };
    }
    return {
      rows: [record],
      rowCount: 1,
      durationMs,
      truncated: false,
    };
  }
  return {
    rows: [],
    rowCount: 0,
    durationMs,
    truncated: false,
  };
}

function applyRowLimit(
  result: SourceAdapterExecuteResult<Record<string, unknown>>,
  rowLimit: number,
): SourceAdapterExecuteResult<Record<string, unknown>> {
  if (result.rows.length <= rowLimit) {
    return result;
  }
  return {
    rows: result.rows.slice(0, rowLimit),
    rowCount: rowLimit,
    durationMs: result.durationMs,
    truncated: true,
  };
}

export async function makeMCPSourceAdapter(
  opts: MCPSourceConfig,
): Promise<MCPSourceAdapterResult> {
  const { serverConfig, name } = opts;
  const adapterId = deriveMCPAdapterId(name, serverConfig);
  const client = new MCPClient({
    id: adapterId,
    servers: { [name]: serverConfig },
  });
  const toolsets = await client.listToolsets();
  const serverTools = toolsets[name] ?? {};

  const tools: Record<string, Tool> = {};
  const rawToolsByName = new Map<string, Tool>();
  const introspectCache: MCPToolInfo[] = [];

  for (const [toolName, tool] of Object.entries(serverTools)) {
    const namespaced = namespaceToolName(name, toolName);
    tools[namespaced] = tool;
    rawToolsByName.set(toolName, tool);
    introspectCache.push({
      name: toolName,
      namespacedName: namespaced,
      description: tool.description,
    });
  }

  const adapter: SourceAdapter<MCPSourceQuery> = {
    kind: "mcp",
    id: adapterId,
    async execute(
      executeOpts: SourceAdapterExecuteOpts<MCPSourceQuery>,
    ): Promise<SourceAdapterExecuteResult<Record<string, unknown>>> {
      const start = Date.now();
      const tool = rawToolsByName.get(executeOpts.query.toolName);
      if (!tool?.execute) {
        throw new Error(`MCP tool not found: ${executeOpts.query.toolName}`);
      }
      const result = await tool.execute(executeOpts.query.args, {});
      const normalized = normalizeToolResult(result, Date.now() - start);
      return applyRowLimit(normalized, executeOpts.rowLimit);
    },
    async introspect(): Promise<MCPToolInfo[]> {
      return introspectCache;
    },
    async verifyOwnerIdentity(): Promise<void> {},
    async close(): Promise<void> {
      await client.disconnect();
    },
  };

  return { adapter, tools };
}
