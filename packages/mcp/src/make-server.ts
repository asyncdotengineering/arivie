/* SPDX-License-Identifier: Apache-2.0 */
import { validateExecuteSql } from "@arivie/db-postgres";
import type { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { MCPServer } from "@mastra/mcp";
import { z } from "zod";
import type { SemanticLayer } from "@arivie/semantic";
import type { McpOptions } from "./types.js";
import { SAMPLE_SEMANTIC } from "./demo.js";

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
    getDescription: () => `Arivie read-only SQL assistant for ${ownerName}`,
  });
}

/** Thrown back to the caller as an MCP tool error when a dependency is unset. */
function notConfigured(what: string, envHint: string): never {
  throw new Error(
    `${what} is not configured on this Arivie MCP server. ` +
      `Start it with ${envHint} (or build the server with makeMcpServer({ ... })). ` +
      `Discovery tools (schema, resources, prompts) work without configuration.`,
  );
}

/** Invokable prompt templates (MCP `prompts` capability). */
function buildPrompts() {
  const prompts = [
    {
      name: "analyze-metric",
      description:
        "Analyze a metric, optionally broken down by a dimension, with assumptions stated.",
      arguments: [
        { name: "metric", description: "Metric/measure to analyze (e.g. net_revenue)", required: true },
        { name: "dimension", description: "Optional dimension to break it down by", required: false },
      ],
    },
    {
      name: "explore-schema",
      description: "Summarize the semantic layer and suggest useful questions to ask.",
      arguments: [],
    },
    {
      name: "weekly-revenue-review",
      description: "Draft a weekly revenue review: trend, top movers, and anomalies.",
      arguments: [],
    },
  ];

  function messagesFor(name: string, args: Record<string, unknown> = {}) {
    const text =
      name === "analyze-metric"
        ? `Analyze the metric "${String(args.metric ?? "<metric>")}"${
            args.dimension ? ` broken down by ${String(args.dimension)}` : ""
          }. State your assumptions (time range, status filters) before the number, run the SQL with the query tool, and explain the result concisely.`
        : name === "explore-schema"
          ? "Call the schema tool, then list the entities, measures, and dimensions available, and suggest three high-value questions a business owner could ask."
          : name === "weekly-revenue-review"
            ? "Produce a weekly revenue review: net revenue by week for the last 8 weeks, the biggest week-over-week movers, and any anomalies. Use the query tool; show the SQL behind each number."
            : `Unknown prompt: ${name}`;
    return [{ role: "user" as const, content: { type: "text" as const, text } }];
  }

  return {
    listPrompts: async () => prompts,
    getPromptMessages: async ({ name, args }: { name: string; args?: Record<string, unknown> }) =>
      messagesFor(name, args ?? {}),
  };
}

/** Attachable context (MCP `resources` capability) — the semantic layer. */
function buildResources(semantic: SemanticLayer, ownerName: string) {
  const ABOUT_URI = "arivie://about";
  const CATALOG_URI = "arivie://semantic/catalog";
  const entityUri = (name: string) => `arivie://semantic/entity/${name}`;

  const aboutText =
    `# Arivie MCP server (${ownerName})\n\n` +
    "Governed text-to-SQL over a semantic layer. Tools: ask, query (read-only SQL), " +
    "schema, memory. Resources expose the semantic catalog and per-entity definitions. " +
    "Prompts wrap common analytics workflows.\n";

  return {
    listResources: async () => [
      { uri: ABOUT_URI, name: "About this server", description: "Overview of the Arivie MCP server.", mimeType: "text/markdown" },
      { uri: CATALOG_URI, name: "Semantic catalog", description: "Entities, keywords, and glossary.", mimeType: "application/json" },
      ...[...semantic.entities.keys()].map((name) => ({
        uri: entityUri(name),
        name: `Entity: ${name}`,
        description: `Measures, dimensions, and joins for ${name}.`,
        mimeType: "application/json",
      })),
    ],
    getResourceContent: async ({ uri }: { uri: string }) => {
      if (uri === ABOUT_URI) return { text: aboutText };
      if (uri === CATALOG_URI) return { text: JSON.stringify(semantic.catalog, null, 2) };
      const prefix = "arivie://semantic/entity/";
      if (uri.startsWith(prefix)) {
        const name = uri.slice(prefix.length);
        const entity = semantic.entities.get(name);
        if (entity) return { text: JSON.stringify(entity, null, 2) };
      }
      throw new Error(`Unknown resource: ${uri}`);
    },
    resourceTemplates: async () => [
      {
        uriTemplate: "arivie://semantic/entity/{name}",
        name: "Semantic entity",
        description: "Definition (measures, dimensions, joins) of a named entity.",
        mimeType: "application/json",
      },
    ],
  };
}

export function makeMcpServer(opts: McpOptions = {}): MCPServer {
  const ownerName = opts.ownerName ?? "Arivie (demo)";
  const semantic = opts.semantic ?? SAMPLE_SEMANTIC;
  const agent = opts.agent;
  const db = opts.db;

  if (agent) {
    ensureAgentDescription(agent, ownerName);
  }

  const ask = createTool({
    id: "ask",
    description: ASK_DESCRIPTION,
    inputSchema: z.object({ prompt: z.string().describe("The question to ask Arivie") }),
    execute: async ({ prompt }) => {
      if (!agent) notConfigured("An agent (model)", "OPENAI_API_KEY set");
      const result = await agent.generate(prompt);
      const text = extractGenerateText(result);
      const toolResults = extractToolResults(result);
      return toolResults !== undefined ? { text, toolResults } : { text };
    },
  });

  const query = createTool({
    id: "query",
    description: QUERY_DESCRIPTION,
    inputSchema: z.object({ sql: z.string().describe("A SELECT or WITH SQL query") }),
    execute: async ({ sql }) => {
      if (!db) notConfigured("A database", "DATABASE_URL set");
      const trimmed = sql.trim();
      validateExecuteSql(trimmed);
      const result = await db.execute({
        query: trimmed,
        runAsRole: "arivie_reader",
        userId: "mcp",
        rowLimit: 50,
        timeoutMs: 30_000,
      });
      return { rows: result.rows, rowCount: result.rowCount, sql: trimmed };
    },
  });

  const schema = createTool({
    id: "schema",
    description: SCHEMA_DESCRIPTION,
    inputSchema: z.object({}),
    execute: async () => ({
      catalog: semantic.catalog,
      entities: [...semantic.entities.values()],
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
    execute: async () => ({
      note: "Memory wiring lands in Sprint 5; Sprint 3 stub returns ok",
    }),
  });

  // Tools (always listable) + prompts + resources + (when configured) the agent
  // as `ask_arivie`. Zero-config boot lists everything; tools needing a missing
  // dependency return an actionable message on invocation.
  return new MCPServer({
    name: `Arivie for ${ownerName}`,
    version: opts.version ?? "0.0.0",
    tools: { ask, query, schema, memory },
    prompts: buildPrompts(),
    resources: buildResources(semantic, ownerName),
    ...(agent ? { agents: { arivie: agent } } : {}),
  });
}
