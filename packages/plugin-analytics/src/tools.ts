/* SPDX-License-Identifier: Apache-2.0 */
import {
  compileMetricFor,
  executeToolFor,
} from "@arivie/agent";
import { getCurrentUserContext } from "@arivie/core/context";
import type { LimitConfig, SourceAdapter } from "@arivie/core";
import type { SemanticLayer } from "@arivie/semantic";
import { createTool, type Tool } from "@mastra/core/tools";
import { z } from "zod";

type PostgresExecuteAdapter = Parameters<typeof executeToolFor>[0]["db"];

export interface BuildAnalyticsToolsOptions {
  readonly semantic: SemanticLayer;
  readonly sources: Record<string, SourceAdapter<unknown>>;
  readonly ownerId: string;
  readonly compileMetric: boolean;
}

function asPostgresAdapter(source: SourceAdapter<unknown>): PostgresExecuteAdapter {
  if (source.kind !== "postgres" || !("url" in source) || !("sql" in source)) {
    throw new Error("expected postgres SourceAdapter");
  }
  return source as unknown as PostgresExecuteAdapter;
}

function executeMcpSourceToolFor({
  source,
  sourceName,
  ownerId,
  limits,
}: {
  source: SourceAdapter<unknown>;
  sourceName: string;
  ownerId: string;
  limits: LimitConfig;
}) {
  const rowLimit = limits.rowsPerQuery ?? 50;
  const timeoutMs = limits.queryTimeoutMs ?? 30_000;
  const toolId = `execute_${sourceName}`;

  return createTool({
    id: toolId,
    description: `Run an MCP tool on source "${sourceName}" via toolName and args.`,
    inputSchema: z.object({
      toolName: z.string().describe("Underlying MCP tool name (not namespaced)"),
      args: z
        .record(z.string(), z.unknown())
        .default({})
        .describe("Arguments forwarded to the MCP tool"),
    }),
    execute: async ({ toolName, args }) => {
      const user = getCurrentUserContext();
      if (user == null) {
        throw new Error("no user context — auth resolver did not run");
      }

      const credentials = user.credentials?.[sourceName];
      const result = await source.execute({
        query: { toolName, args },
        runAsRole: user.dbRole,
        userId: user.userId,
        rowLimit,
        timeoutMs,
        ...(credentials !== undefined ? { credentials } : {}),
      });

      return {
        rows: result.rows,
        rowCount: result.rowCount,
        truncated: result.truncated,
      };
    },
  });
}

function executeAdapterSourceToolFor({
  source,
  sourceName,
  ownerId,
  limits,
}: {
  source: SourceAdapter<unknown>;
  sourceName: string;
  ownerId: string;
  limits: LimitConfig;
}) {
  const rowLimit = limits.rowsPerQuery ?? 50;
  const timeoutMs = limits.queryTimeoutMs ?? 30_000;
  const toolId = `execute_${sourceName}`;

  return createTool({
    id: toolId,
    description: `Execute a ${source.kind} query on source "${sourceName}".`,
    inputSchema: z.object({
      query: z
        .record(z.string(), z.unknown())
        .describe(`Adapter-specific query payload for ${source.kind}`),
    }),
    execute: async ({ query }) => {
      const user = getCurrentUserContext();
      if (user == null) {
        throw new Error("no user context — auth resolver did not run");
      }

      const credentials = user.credentials?.[sourceName];
      const result = await source.execute({
        query,
        runAsRole: user.dbRole,
        userId: user.userId,
        rowLimit,
        timeoutMs,
        ...(credentials !== undefined ? { credentials } : {}),
      });

      return {
        rows: result.rows,
        rowCount: result.rowCount,
        truncated: result.truncated,
      };
    },
  });
}

function executeSourceToolFor({
  source,
  sourceName,
  ownerId,
  limits,
}: {
  source: SourceAdapter<unknown>;
  sourceName: string;
  ownerId: string;
  limits: LimitConfig;
}) {
  if (source.kind === "mcp") {
    return executeMcpSourceToolFor({ source, sourceName, ownerId, limits });
  }

  return executeAdapterSourceToolFor({ source, sourceName, ownerId, limits });
}

export function buildAnalyticsTools({
  semantic,
  sources,
  ownerId,
  compileMetric,
}: BuildAnalyticsToolsOptions): Record<string, Tool> {
  const limits: LimitConfig = {};
  const tools: Record<string, Tool> = {};

  for (const [name, source] of Object.entries(sources)) {
    tools[`execute_${name}`] =
      (source.kind === "postgres"
        ? executeToolFor({
            db: asPostgresAdapter(source),
            ownerId,
            sourceName: name,
            limits,
            toolId: `execute_${name}`,
          })
        : executeSourceToolFor({
            source,
            sourceName: name,
            ownerId,
            limits,
          })) as unknown as Tool;
  }

  if (compileMetric) {
    tools.compile_metric = compileMetricFor({
      semantic,
      sources,
      ownerId,
      limits,
    }) as unknown as Tool;
  }

  return tools;
}
