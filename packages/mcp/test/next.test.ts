/* SPDX-License-Identifier: Apache-2.0 */
import type { MCPServer } from "@mastra/mcp";
import { describe, expect, it, vi } from "vitest";
import { makeMcpRouteHandler } from "../src/next.js";

function mockMcp(
  startHTTP: ReturnType<typeof vi.fn>,
): MCPServer {
  return { startHTTP } as unknown as MCPServer;
}

describe("makeMcpRouteHandler", () => {
  it("delegates to mcp.startHTTP and returns a Web Response", async () => {
    const startHTTP = vi.fn(
      async ({
        res,
      }: {
        res: {
          writeHead: (code: number, headers?: Record<string, string>) => void;
          end: (body: string) => void;
        };
      }) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", result: {}, id: 1 }));
      },
    );
    const handler = makeMcpRouteHandler(mockMcp(startHTTP));
    const req = new Request("https://example.com/api/arivie/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", id: 1 }),
    });

    const res = await handler(req);

    expect(startHTTP).toHaveBeenCalledOnce();
    expect(startHTTP.mock.calls[0]?.[0]).toMatchObject({
      httpPath: "/api/arivie/mcp",
      options: { serverless: true },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    await expect(res.json()).resolves.toEqual({
      jsonrpc: "2.0",
      result: {},
      id: 1,
    });
  });

  it("returns 4xx when startHTTP writes a client error", async () => {
    const startHTTP = vi.fn(
      async ({
        res,
      }: {
        res: {
          writeHead: (code: number, headers?: Record<string, string>) => void;
          end: (body: string) => void;
        };
      }) => {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32700, message: "Parse error" },
            id: null,
          }),
        );
      },
    );
    const handler = makeMcpRouteHandler(mockMcp(startHTTP));
    const req = new Request("https://example.com/api/arivie/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not-json",
    });

    const res = await handler(req);

    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toBe("application/json");
    const body = await res.json();
    expect(body.error?.message).toBe("Parse error");
  });

  it("returns 500 JSON when startHTTP throws", async () => {
    const startHTTP = vi.fn(async () => {
      throw new Error("transport wedged");
    });
    const handler = makeMcpRouteHandler(mockMcp(startHTTP));
    const req = new Request("https://example.com/api/arivie/mcp", {
      method: "POST",
    });

    const res = await handler(req);

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error: "mcp-error",
      message: "transport wedged",
    });
  });

  it("POST is an alias for makeMcpRouteHandler", async () => {
    const { POST } = await import("../src/next.js");
    expect(POST).toBe(makeMcpRouteHandler);
  });
});
