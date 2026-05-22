/* SPDX-License-Identifier: Apache-2.0 */
import type { MCPServerConfig, SourceConfigEntry } from "./types.js";

/**
 * One-line MCP source factory. Every source carries a `description`
 * (required) so the agent knows what's behind the connection, and an
 * optional `useWhen` to disambiguate against other sources.
 *
 * ```ts
 * import { defineArivie, mcpSource } from "@arivie/core";
 *
 * await defineArivie({
 *   sources: {
 *     linear: mcpSource({
 *       description: "Linear issue tracker — projects, issues, comments",
 *       useWhen: "any project status / ticket / engineering-progress question",
 *       command: "linear-mcp-server",
 *       env: { LINEAR_API_KEY: process.env.LINEAR_API_KEY! },
 *     }),
 *   },
 *   ...,
 * });
 * ```
 */
export function mcpSource(
  config: MCPServerConfig & { description: string; useWhen?: string },
): SourceConfigEntry {
  const { description, useWhen, ...mcp } = config;
  return {
    mcp,
    description,
    ...(useWhen !== undefined ? { useWhen } : {}),
  };
}
