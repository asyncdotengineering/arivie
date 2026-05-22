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
    kind: "mcp",
    mcp,
    description,
    ...(useWhen !== undefined ? { useWhen } : {}),
  };
}

/**
 * One-line factory for an adapter-backed source entry. Wraps a
 * `SourceAdapter` (typically from `postgresAdapter`) with the required
 * description so the agent's system prompt can advertise it correctly.
 *
 * ```ts
 * import { defineArivie, adapterSource } from "@arivie/core";
 * import { postgresAdapter } from "@arivie/db-postgres";
 *
 * await defineArivie({
 *   sources: {
 *     commerce: adapterSource({
 *       adapter: postgresAdapter({ url, readOnlyRole }),
 *       description: "Commerce DB — customers, orders, products",
 *       useWhen: "any revenue / orders / customer / product question",
 *     }),
 *   },
 *   ...,
 * });
 * ```
 */
export function adapterSource<TQuery = unknown>(opts: {
  adapter: import("./types.js").SourceAdapter<TQuery>;
  description: string;
  useWhen?: string;
}): SourceConfigEntry {
  return {
    kind: "adapter",
    adapter: opts.adapter as import("./types.js").SourceAdapter<unknown>,
    description: opts.description,
    ...(opts.useWhen !== undefined ? { useWhen: opts.useWhen } : {}),
  };
}
