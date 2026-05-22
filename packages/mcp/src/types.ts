/* SPDX-License-Identifier: Apache-2.0 */
import type { Agent } from "@mastra/core/agent";
import type { PostgresAdapter } from "@arivie/db-postgres";
import type { SemanticLayer } from "@arivie/semantic";

export interface McpOptions {
  readonly agent: Agent;
  readonly semantic: SemanticLayer;
  readonly db: PostgresAdapter;
  readonly ownerId: string;
  readonly ownerName: string;
  readonly version?: string;
}
