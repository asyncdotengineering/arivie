/* SPDX-License-Identifier: Apache-2.0 */
import type { Agent } from "@mastra/core/agent";
import type { PostgresAdapter } from "@arivie/db-postgres";
import type { SemanticLayer } from "@arivie/semantic";

/**
 * Options for {@link makeMcpServer}. `agent`, `semantic`, and `db` are optional
 * so the server can boot **zero-config** (e.g. `npx @arivie/mcp` for discovery /
 * LobeHub validation): tools + prompts + resources are always listable; tools
 * that need a missing dependency return an actionable "configure X" message when
 * invoked, and `schema`/resources fall back to a bundled sample semantic layer.
 */
export interface McpOptions {
  readonly agent?: Agent;
  readonly semantic?: SemanticLayer;
  readonly db?: PostgresAdapter;
  readonly ownerId?: string;
  readonly ownerName?: string;
  readonly version?: string;
}
