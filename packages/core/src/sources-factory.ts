/* SPDX-License-Identifier: Apache-2.0 */
import type { MCPServerConfig, SourceConfigEntry } from "./types.js";

/**
 * One-line MCP source factory.
 *
 * ```ts
 * import { defineArivie, mcpSource } from "@arivie/core";
 *
 * await defineArivie({
 *   sources: {
 *     linear: mcpSource({
 *       command: "linear-mcp-server",
 *       env: { LINEAR_API_KEY: process.env.LINEAR_API_KEY! },
 *     }),
 *   },
 *   ...,
 * });
 * ```
 *
 * Equivalent to writing `{ mcp: { command, env, ... } }` inline, but
 * reads as a single named factory at the call site — and makes the
 * `mcp:` discriminator a Mastra-internal detail rather than something
 * the user has to remember.
 */
export function mcpSource(config: MCPServerConfig): SourceConfigEntry {
  return { mcp: config };
}
