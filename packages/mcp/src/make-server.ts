/* SPDX-License-Identifier: Apache-2.0 */
import { validateExecuteSql } from "@arivie/db-postgres";
import type { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { MCPServer } from "@mastra/mcp";
import { z } from "zod";
import type { McpOptions } from "./types.js";

const ASK_DESCRIPTION =
  "Ask Arivie a question; runs the agent's full conversational round-trip.";
const QUERY_DESCRIPTION =
  "Execute a read-only SQL query against the owner's database.";
const SCHEMA_DESCRIPTION =
  "Return the semantic-layer catalog + entities for this owner.";
const MEMORY_DESCRIPTION =
  "Read/write Mastra Memory through the agent's storage. (Sprint 5 wiring; v0.1 returns stub.)";

function extractGenerateText(result: unknown): string {
  if (result != null && typeof result === "object" && "text" in result) {
    const text = (result as { text: unknown }).text;
    if (typeof text === "string") {
      return text;
    }
  }
  return String(result);
}

function extractToolResults(result: unknown): unknown | undefined {
  if (result != null && typeof result === "object" && "toolResults" in result) {
    return (result as { toolResults: unknown }).toolResults;
  }
  return undefined;
}

/** Mastra MCPServer.convertAgentsToTools requires a non-empty agent description. */
function ensureAgentDescription(agent: Agent, ownerName: string): void {
  if (agent.getDescription().trim().length > 0) {
    return;
  }
  Object.assign(agent, {
    getDescription: () =>
      `Arivie read-only SQL assistant for ${ownerName}`,
  });
}

export function makeMcpServer(opts: McpOptions): MCPServer {
  ensureAgentDescription(opts.agent, opts.ownerName);
  const ask = createTool({
    id: "ask",
    description: ASK_DESCRIPTION,
    inputSchema: z.object({
      prompt: z.string().describe("The question to ask Arivie"),
    }),
    execute: async ({ prompt }) => {
      const result = await opts.agent.generate(prompt);
      const text = extractGenerateText(result);
      const toolResults = extractToolResults(result);
      return toolResults !== undefined ? { text, toolResults } : { text };
    },
  });

  const query = createTool({
    id: "query",
    description: QUERY_DESCRIPTION,
    inputSchema: z.object({
      sql: z.string().describe("A SELECT or WITH SQL query"),
    }),
    execute: async ({ sql }) => {
      const trimmed = sql.trim();
      validateExecuteSql(trimmed);

      const result = await opts.db.execute({
        query: trimmed,
        runAsRole: "arivie_reader",
        userId: "mcp",
        rowLimit: 50,
        timeoutMs: 30_000,
      });

      return {
        rows: result.rows,
        rowCount: result.rowCount,
        sql: trimmed,
      };
    },
  });

  const schema = createTool({
    id: "schema",
    description: SCHEMA_DESCRIPTION,
    inputSchema: z.object({}),
    execute: async () => ({
      catalog: opts.semantic.catalog,
      entities: [...opts.semantic.entities.values()],
    }),
  });

  const memory = createTool({
    id: "memory",
    description: MEMORY_DESCRIPTION,
    inputSchema: z.object({
      action: z.enum(["list", "save", "delete"]),
      key: z.string().optional(),
      value: z.string().optional(),
    }),
    execute: async () => {
      // Sprint 5 wires Mastra Memory read/write through the agent's storage.
      return {
        note: "Memory wiring lands in Sprint 5; Sprint 3 stub returns ok",
      };
    },
  });

  // Explicit tools: ask, query, schema, memory. Mastra also registers ask_arivie
  // from agents.arivie (REQ-26 — same Agent instance reference).
  return new MCPServer({
    name: `Arivie for ${opts.ownerName}`,
    version: opts.version ?? "0.0.0",
    tools: { ask, query, schema, memory },
    agents: { arivie: opts.agent },
  });
}
