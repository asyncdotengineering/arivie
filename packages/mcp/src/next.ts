/* SPDX-License-Identifier: Apache-2.0 */
import type { MCPServer } from "@mastra/mcp";
import { EventEmitter } from "node:events";
import type * as http from "node:http";

type NodeRequest = http.IncomingMessage & { body?: unknown };
type NodeResponse = http.ServerResponse<http.IncomingMessage>;

interface CapturedResponse {
  res: NodeResponse;
  toWebResponse(): Response;
}

/**
 * Next.js App Router adapter — returns a `POST` handler for `route.ts`.
 * Delegates to Mastra {@link MCPServer.startHTTP} in serverless mode (stateless
 * per request, suited to serverless route handlers).
 */
export function makeMcpRouteHandler(mcp: MCPServer): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    try {
      const url = new URL(req.url);
      const nodeReq = await webRequestToNodeRequest(req);
      const captured = createNodeResponse();

      await mcp.startHTTP({
        url,
        httpPath: url.pathname,
        req: nodeReq,
        res: captured.res,
        options: { serverless: true },
      });

      return captured.toWebResponse();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return Response.json(
        { error: "mcp-error", message },
        { status: 500 },
      );
    }
  };
}

/** Alias for {@link makeMcpRouteHandler} — use `export const POST = makeMcpRouteHandler(mcp)`. */
export { makeMcpRouteHandler as POST };

async function webRequestToNodeRequest(req: Request): Promise<NodeRequest> {
  const url = new URL(req.url);
  const nodeReq = new EventEmitter() as NodeRequest;

  nodeReq.method = req.method;
  nodeReq.url = `${url.pathname}${url.search}`;
  nodeReq.headers = Object.fromEntries(req.headers.entries());

  const raw = await req.arrayBuffer();
  if (raw.byteLength === 0) {
    return nodeReq;
  }

  const text = new TextDecoder().decode(raw);
  try {
    nodeReq.body = JSON.parse(text) as unknown;
  } catch {
    // Mastra readJsonBody falls back to stream events; replay the bytes.
    queueMicrotask(() => {
      nodeReq.emit("data", Buffer.from(text));
      nodeReq.emit("end");
    });
  }

  return nodeReq;
}

function createNodeResponse(): CapturedResponse {
  let statusCode = 200;
  let headersSent = false;
  const headerStore = new Map<string, string | string[]>();
  const chunks: Buffer[] = [];

  const res = new EventEmitter() as NodeResponse;

  const assignHeaders = (headers: http.OutgoingHttpHeaders | undefined): void => {
    if (!headers) {
      return;
    }
    for (const [name, value] of Object.entries(headers)) {
      if (value === undefined) {
        continue;
      }
      headerStore.set(
        name.toLowerCase(),
        Array.isArray(value) ? value.map(String) : String(value),
      );
    }
  };

  res.writeHead = ((status: number, headers?: http.OutgoingHttpHeaders) => {
    statusCode = status;
    headersSent = true;
    assignHeaders(headers);
    return res;
  }) as NodeResponse["writeHead"];

  res.setHeader = (name: string, value: string | number | readonly string[]) => {
    headerStore.set(
      name.toLowerCase(),
      Array.isArray(value) ? value.map(String) : String(value),
    );
    return res;
  };

  res.getHeader = (name: string) => headerStore.get(name.toLowerCase());

  res.removeHeader = (name: string) => {
    headerStore.delete(name.toLowerCase());
  };

  res.write = (chunk: string | Uint8Array) => {
    headersSent = true;
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return true;
  };

  res.end = ((chunk?: unknown) => {
    if (chunk !== undefined && chunk !== null) {
      if (typeof chunk === "string") {
        chunks.push(Buffer.from(chunk));
      } else if (Buffer.isBuffer(chunk)) {
        chunks.push(chunk);
      } else if (chunk instanceof Uint8Array) {
        chunks.push(Buffer.from(chunk));
      }
    }
    headersSent = true;
    res.emit("finish");
    return res;
  }) as NodeResponse["end"];

  Object.defineProperty(res, "headersSent", {
    get: () => headersSent,
    configurable: true,
  });

  return {
    res,
    toWebResponse(): Response {
      const body = Buffer.concat(chunks);
      const headers = new Headers();
      for (const [name, value] of headerStore) {
        if (Array.isArray(value)) {
          for (const entry of value) {
            headers.append(name, entry);
          }
        } else {
          headers.set(name, value);
        }
      }
      return new Response(body.byteLength > 0 ? body : null, {
        status: statusCode,
        headers,
      });
    },
  };
}
