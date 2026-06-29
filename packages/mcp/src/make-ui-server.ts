/* SPDX-License-Identifier: Apache-2.0 */
import { validateExecuteSql } from "@arivie/db-postgres";
import type { Agent } from "@mastra/core/agent";
import { createMcpApp, registerJsonRenderTool } from "@json-render/mcp";
import { z } from "zod";

type CreateMcpAppReturn = Awaited<ReturnType<typeof createMcpApp>>;
import { arivieUiCatalog } from "@arivie/ui-catalog";
import { DEFAULT_UI_SHELL_HTML } from "./ui-shell.js";
import type { McpOptions } from "./types.js";

export interface MakeMcpUiServerOptions extends McpOptions {
  /**
   * Override the default HTML shell. When omitted, a CDN-loaded shell is
   * served that renders the Arivie catalog. Pass a pre-built bundle here
   * for production deployments (no runtime esm.sh fetch, brand styling).
   */
  html?: string;
}

/**
 * Build an MCP server that returns **renderable UI** to MCP UI-aware
 * clients (Claude Desktop, Cursor, ChatGPT). Pairs Arivie's analytics
 * tools (`ask`, `query`, `schema`) with `@json-render/mcp`'s catalog-
 * driven render path.
 *
 * Wire shape:
 *   1. `createMcpApp({ catalog, html })` registers the canonical
 *      `render-ui` tool + the UI resource at `ui://render-ui/view.html`.
 *      MCP clients use this when the agent emits a json-render spec.
 *   2. We layer Arivie's `ask` / `query` / `schema` tools on top of the
 *      same server. Their results are JSON-shaped (rows + SQL + metadata)
 *      so the client can either render them as plain JSON OR pass them
 *      back through `render-ui` with a spec.
 *
 * Catalog: 36 shadcn components + 4 Arivie-specific
 * (`ArivieMetric`, `ArivieQueryResult`, `ArivieVerdict`,
 * `ArivieSemanticEntity`).
 *
 * Smaller models (Gemini Flash, Grok) sometimes emit malformed specs;
 * the json-render tool validates against the catalog's Zod schema and
 * returns the partial spec rather than crashing.
 */
export async function makeMcpUiServer(
  opts: MakeMcpUiServerOptions,
): Promise<CreateMcpAppReturn> {
  // The UI server is the fully-wired surface; the zero-config discovery server
  // (makeMcpServer / `npx @arivie/mcp`) is where agent/db/semantic are optional.
  if (!opts.agent || !opts.db || !opts.semantic) {
    throw new Error(
      "makeMcpUiServer requires agent, db, and semantic. Use makeMcpServer for the zero-config server.",
    );
  }
  const { agent, db, semantic } = opts;
  const html = opts.html ?? DEFAULT_UI_SHELL_HTML;

  const server = await createMcpApp({
    name: `Arivie (${opts.ownerName})`,
    version: "0.3.0",
    catalog: arivieUiCatalog,
    html,
    tool: {
      name: "render_arivie_ui",
      title: "Render Arivie UI",
      description:
        "Render an interactive UI for an analytics result. Pass a json-render " +
        "`spec` built from the Arivie catalog (ArivieMetric, ArivieQueryResult, " +
        "ArivieVerdict, ArivieSemanticEntity, plus shadcn components). The MCP " +
        "client renders the spec inside its UI surface.",
    },
  });

  // Layer Arivie's analytics tools onto the same MCP server. The
  // render_arivie_ui tool above handles the rendering; these run the
  // actual work and return data the client can either show as JSON or
  // feed back through render_arivie_ui.

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = server as any;

  s.registerTool(
    "ask",
    {
      title: "Ask Arivie",
      description:
        "Ask Arivie a natural-language question. Runs the full agent loop " +
        "(semantic-layer-grounded SQL + optional file artifacts). Returns the " +
        "agent's answer text plus the tool trace. For UI rendering, also " +
        "consider calling `render_arivie_ui` with a spec built from the result.",
      inputSchema: {
        prompt: z.string().describe("The question to ask Arivie"),
      },
    },
    async ({ prompt }: { prompt: string }) => {
      const result = await agent.generate(prompt);
      const text =
        result != null && typeof result === "object" && "text" in result
          ? String((result as { text: unknown }).text)
          : String(result);
      return { content: [{ type: "text" as const, text }] };
    },
  );

  s.registerTool(
    "query",
    {
      title: "Execute SQL",
      description:
        "Execute a read-only SQL query against the owner's database. " +
        "Returns rows + SQL + timing. To render as a table card, pass the " +
        "result into `render_arivie_ui` with an ArivieQueryResult spec.",
      inputSchema: {
        sql: z.string().describe("A SELECT or WITH SQL query"),
      },
    },
    async ({ sql }: { sql: string }) => {
      const trimmed = sql.trim();
      validateExecuteSql(trimmed);
      const start = Date.now();
      const result = await db.execute({
        query: trimmed,
        runAsRole: "arivie_reader",
        userId: "mcp",
        rowLimit: 50,
        timeoutMs: 30_000,
      });
      const durationMs = Date.now() - start;
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              rows: result.rows,
              rowCount: result.rowCount,
              truncated: result.truncated,
              durationMs,
              sql: trimmed,
              source: "postgres",
            }),
          },
        ],
      };
    },
  );

  s.registerTool(
    "schema",
    {
      title: "Semantic Layer",
      description:
        "Return the semantic-layer catalog + entities for this owner. " +
        "Each entity surfaces measures, dimensions, segments, joins. To " +
        "render one entity as a card, pass it into `render_arivie_ui` " +
        "with an ArivieSemanticEntity spec.",
      inputSchema: {},
    },
    async () => ({
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            catalog: semantic.catalog,
            entities: [...semantic.entities.values()],
          }),
        },
      ],
    }),
  );

  return server;
}

// Re-export so callers can register additional tools if they want.
export { registerJsonRenderTool };
