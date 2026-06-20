/* SPDX-License-Identifier: Apache-2.0 */
import { createServer } from "node:http";
import { defineArivie } from "@arivie/core";
import { loadSemanticLayerSync } from "@arivie/semantic";
import { makeMcpServer, makeMcpUiServer } from "@arivie/mcp";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { defineCommand } from "citty";
import { loadArivieConfig } from "../lib/load-config.js";
import { postgresAdapterFromConfig } from "../lib/postgres-from-config.js";
import { printCliCommandError } from "../lib/cli-errors.js";

interface RunOptions {
  configPath: string;
  http?: boolean;
  port?: number;
  host?: string;
  path?: string;
  /**
   * Use the json-render UI server (returns interactive UI to MCP UI-aware
   * clients like Claude Desktop / Cursor) instead of the canonical Mastra
   * tool-only server.
   */
  ui?: boolean;
}

/**
 * Boot the Arivie MCP server from a config file. Stdio by default (the
 * shape every MCP client expects when launching the server as a
 * subprocess) or HTTP via `--http --port`. The server exposes:
 *   - `ask`     — full agent round-trip
 *   - `query`   — read-only SQL execution
 *   - `schema`  — semantic-layer catalog + entities
 *   - `memory`  — Mastra Memory read/write (stub today)
 *
 * Multi-MCP works orthogonally: this command exposes Arivie AS an MCP
 * server, while `sources: { foo: mcpSource(...), bar: mcpSource(...) }`
 * in the Arivie config consumes other MCP servers. The agent can sit
 * at both ends of the protocol simultaneously.
 */
export async function runMcpCommand(opts: RunOptions): Promise<number> {
  try {
    const config = await loadArivieConfig(opts.configPath);
    const instance = await defineArivie(config);
    const db = postgresAdapterFromConfig(config);
    const semantic = loadSemanticLayerSync(config.semantic.path);

    // `--ui` swaps to the json-render-powered server with the Arivie
    // catalog + renderable HTML resource. Same `ask` / `query` / `schema`
    // tools, plus `render_arivie_ui` for clients that render specs.
    if (opts.ui === true) {
      return await runUiServer({
        instance,
        db,
        semantic,
        ownerName: config.owner.name,
        ownerId: config.owner.id,
        http: opts.http === true,
        port: opts.port ?? 8181,
        host: opts.host ?? "127.0.0.1",
        path: opts.path ?? "/mcp",
      });
    }

    const server = makeMcpServer({
      agent: instance.agent,
      db,
      semantic,
      ownerId: config.owner.id,
      ownerName: config.owner.name,
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
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
          }
          res.end(
            JSON.stringify({
              error: "internal",
              detail: err instanceof Error ? err.message : String(err),
            }),
          );
        }
      });

      await new Promise<void>((resolve, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(port, host, () => {
          process.stderr.write(
            `arivie mcp: HTTP transport listening on http://${host}:${port}${httpPath}\n`,
          );
          resolve();
        });
      });

      const shutdown = (signal: NodeJS.Signals) => {
        process.stderr.write(`arivie mcp: ${signal} received, shutting down…\n`);
        httpServer.close(() => {
          instance.dispose().finally(() => process.exit(0));
        });
      };
      process.once("SIGINT", () => shutdown("SIGINT"));
      process.once("SIGTERM", () => shutdown("SIGTERM"));

      return await new Promise<number>((resolve) => {
        httpServer.once("close", () => resolve(0));
      });
    }

    // stdio path: blocks on stdin until the client closes it.
    process.stderr.write(
      `arivie mcp: stdio transport ready (owner=${config.owner.id})\n`,
    );
    const shutdown = async () => {
      try {
        await instance.dispose();
      } catch {
        // dispose() best-effort during shutdown
      }
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
      "Boot the Arivie MCP server from arivie.config.ts. Stdio by default; " +
      "use --http --port N for HTTP transport (Streamable HTTP, the modern MCP spec). " +
      "Multi-MCP composition is orthogonal: this command exposes Arivie AS a server, " +
      "while mcpSource() entries in your config consume other servers.",
  },
  args: {
    config: {
      type: "string",
      description: "Path to arivie.config.ts",
      default: "./arivie.config.ts",
    },
    http: {
      type: "boolean",
      description: "Use HTTP transport instead of stdio",
      default: false,
    },
    port: {
      type: "string",
      description: "HTTP port (default 8181)",
    },
    host: {
      type: "string",
      description: "HTTP bind address (default 127.0.0.1)",
    },
    path: {
      type: "string",
      description: "HTTP path (default /mcp)",
    },
    ui: {
      type: "boolean",
      description:
        "Serve the json-render UI variant — returns renderable specs to " +
        "MCP UI-aware clients (Claude Desktop, Cursor). Default off.",
      default: false,
    },
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runUiServer(opts: {
  instance: { agent: any; dispose: () => Promise<void> };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  semantic: any;
  ownerName: string;
  ownerId: string;
  http: boolean;
  port: number;
  host: string;
  path: string;
}): Promise<number> {
  const server = await makeMcpUiServer({
    agent: opts.instance.agent,
    db: opts.db,
    semantic: opts.semantic,
    ownerId: opts.ownerId,
    ownerName: opts.ownerName,
  });

  if (opts.http) {
    const httpServer = createServer(async (req, res) => {
      const transport = new StreamableHTTPServerTransport();
      res.on("close", () => {
        transport.close().catch(() => undefined);
      });
      try {
        await server.connect(transport);
        const chunks: Buffer[] = [];
        for await (const c of req as AsyncIterable<Buffer>) chunks.push(c);
        const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
        await transport.handleRequest(req, res, body);
      } catch (err) {
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
        }
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: {
              code: -32603,
              message: err instanceof Error ? err.message : String(err),
            },
            id: null,
          }),
        );
      }
    });
    await new Promise<void>((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.listen(opts.port, opts.host, () => {
        process.stderr.write(
          `arivie mcp --ui: HTTP transport listening on http://${opts.host}:${opts.port}${opts.path}\n`,
        );
        resolve();
      });
    });
    const shutdown = () => {
      httpServer.close(() => {
        opts.instance.dispose().finally(() => process.exit(0));
      });
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    return await new Promise<number>((resolve) => {
      httpServer.once("close", () => resolve(0));
    });
  }

  // stdio path
  process.stderr.write(
    `arivie mcp --ui: stdio transport ready (owner=${opts.ownerId}, json-render catalog active)\n`,
  );
  const transport = new StdioServerTransport();
  const shutdown = async () => {
    try {
      await transport.close();
    } catch {
      /* best effort */
    }
    try {
      await opts.instance.dispose();
    } catch {
      /* best effort */
    }
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
  await server.connect(transport);
  // Block until stdin closes (client disconnects) — `server.connect`
  // just sets up handlers and returns; if we exit, the child process
  // dies before the client can talk.
  await new Promise<void>((resolve) => {
    process.stdin.on("end", resolve);
    process.stdin.on("close", resolve);
  });
  return 0;
}
