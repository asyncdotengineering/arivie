/* SPDX-License-Identifier: Apache-2.0 */
import { createServer } from "node:http";
import { defineArivie } from "@arivie/core";
import { loadSemanticLayerSync } from "@arivie/semantic";
import { makeMcpServer } from "@arivie/mcp";
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

    const server = makeMcpServer({
      agent: instance.agent,
      db,
      semantic,
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
  },
  async run({ args }) {
    return runMcpCommand({
      configPath: args.config as string,
      http: args.http === true || args.http === "true",
      ...(args.port !== undefined ? { port: Number(args.port) } : {}),
      ...(args.host !== undefined ? { host: args.host as string } : {}),
      ...(args.path !== undefined ? { path: args.path as string } : {}),
    });
  },
});
