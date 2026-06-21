/* SPDX-License-Identifier: Apache-2.0 */
import { createServer } from "node:http";
import { type ArivieApp, defineArivie, type ArivieEvent } from "@arivie/core";
import { validateExecuteSql } from "@arivie/db-postgres";
import { createTool } from "@mastra/core/tools";
import { MCPServer } from "@mastra/mcp";
import { defineCommand } from "citty";
import { z } from "zod";
import { loadSemanticLayerSync } from "@arivie/semantic";
import { loadArivieConfig } from "../lib/load-config.js";
import { postgresAdapterFromConfig } from "../lib/postgres-from-config.js";
import { printCliCommandError } from "../lib/cli-errors.js";
import { ownerIdFromConfig, semanticPathFromConfig } from "../lib/app-config.js";

interface RunOptions {
  configPath: string;
  http?: boolean;
  port?: number;
  host?: string;
  path?: string;
  ui?: boolean;
}

async function collectText(stream: ReadableStream<ArivieEvent>): Promise<string> {
  const reader = stream.getReader();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value.type === "run.completed") {
      text = typeof value.payload.text === "string" ? value.payload.text : "";
    }
  }
  return text;
}

function makeAppMcpServer(opts: {
  app: ArivieApp;
  ownerId: string;
  ownerName: string;
  db: ReturnType<typeof postgresAdapterFromConfig>;
  semanticPath: string;
}): MCPServer {
  const ask = createTool({
    id: "ask",
    description: "Ask Arivie through the v2 runtime session API.",
    inputSchema: z.object({
      prompt: z.string(),
      agent: z.string().optional(),
    }),
    execute: async ({ prompt, agent }) => {
      const handle = await opts.app.sessions.create({
        agent: agent ?? "analyst",
        prompt,
        user: {
          userId: "mcp",
          permissions: ["analytics:read"],
          dbRole: "arivie_reader",
        },
        session: { resource: "mcp" },
      });
      return { text: await collectText(handle.stream) };
    },
  });

  const query = createTool({
    id: "query",
    description: "Execute a read-only SQL query against the configured Postgres source.",
    inputSchema: z.object({ sql: z.string() }),
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
      return { rows: result.rows, rowCount: result.rowCount, sql: trimmed };
    },
  });

  const schema = createTool({
    id: "schema",
    description: "Return the configured analytics semantic catalog.",
    inputSchema: z.object({}),
    execute: async () => {
      const semantic = loadSemanticLayerSync(opts.semanticPath);
      return {
        catalog: semantic.catalog,
        entities: [...semantic.entities.values()],
      };
    },
  });

  return new MCPServer({
    name: `Arivie for ${opts.ownerName}`,
    version: "0.0.0",
    tools: { ask, query, schema },
  });
}

export async function runMcpCommand(opts: RunOptions): Promise<number> {
  try {
    if (opts.ui === true) {
      throw new Error("arivie mcp --ui requires the removed legacy raw-agent surface");
    }
    const config = await loadArivieConfig(opts.configPath);
    const app = await defineArivie(config);
    const db = postgresAdapterFromConfig(config);
    const ownerId = ownerIdFromConfig(config);
    const server = makeAppMcpServer({
      app,
      db,
      ownerId,
      ownerName: config.app.name,
      semanticPath: semanticPathFromConfig(config),
    });

    if (opts.http === true) {
      const port = opts.port ?? 8181;
      const host = opts.host ?? "127.0.0.1";
      const httpPath = opts.path ?? "/mcp";
      const httpServer = createServer(async (req, res) => {
        try {
          await server.startHTTP({
            url: new URL(`http://${host}:${port}${req.url ?? "/"}`),
            httpPath,
            req,
            res,
          });
        } catch (err) {
          if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "internal", detail: err instanceof Error ? err.message : String(err) }));
        }
      });
      await new Promise<void>((resolve, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(port, host, resolve);
      });
      const shutdown = () => {
        httpServer.close(() => {
          app.dispose().finally(() => process.exit(0));
        });
      };
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
      return await new Promise<number>((resolve) => {
        httpServer.once("close", () => resolve(0));
      });
    }

    const shutdown = async () => {
      await app.dispose();
      process.exit(0);
    };
    process.once("SIGINT", () => void shutdown());
    process.once("SIGTERM", () => void shutdown());
    await server.startStdio();
    return 0;
  } catch (err) {
    printCliCommandError("mcp", err);
    return 1;
  }
}

export const mcpCommand = defineCommand({
  meta: {
    name: "mcp",
    description:
      "Boot the Arivie MCP server from arivie.config.ts. Stdio by default; use --http --port N for HTTP transport. Multi-MCP composition is orthogonal.",
  },
  args: {
    config: { type: "string", description: "Path to arivie.config.ts", default: "./arivie.config.ts" },
    http: { type: "boolean", description: "Use HTTP transport instead of stdio", default: false },
    port: { type: "string", description: "HTTP port (default 8181)" },
    host: { type: "string", description: "HTTP bind address (default 127.0.0.1)" },
    path: { type: "string", description: "HTTP path (default /mcp)" },
    ui: { type: "boolean", description: "Serve the json-render UI variant", default: false },
  },
  async run({ args }) {
    return runMcpCommand({
      configPath: args.config as string,
      http: args.http === true,
      ui: args.ui === true,
      ...(args.port !== undefined ? { port: Number(args.port) } : {}),
      ...(args.host !== undefined ? { host: args.host as string } : {}),
      ...(args.path !== undefined ? { path: args.path as string } : {}),
    });
  },
});
