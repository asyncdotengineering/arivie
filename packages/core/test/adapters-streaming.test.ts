/* SPDX-License-Identifier: Apache-2.0 */
import type { Context } from "hono";
import { describe, expect, it } from "vitest";
import { bunHandler } from "../src/adapters/bun.js";
import { honoMiddleware } from "../src/adapters/hono.js";
import { makeNextAdapter } from "../src/adapters/next.js";
import { workerHandler } from "../src/adapters/worker.js";

const SSE_CONTENT_TYPE = "text/event-stream";
const SSE_BODY = "data: chunk-1\n\ndata: [DONE]\n\n";

function createSseHandler(): {
  handler: (req: Request) => Promise<Response>;
  getLastResponse: () => Response | undefined;
} {
  let lastResponse: Response | undefined;

  const handler = async (_req: Request) => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(SSE_BODY));
        controller.close();
      },
    });

    lastResponse = new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": SSE_CONTENT_TYPE,
        "Cache-Control": "no-cache",
      },
    });
    return lastResponse;
  };

  return {
    handler,
    getLastResponse: () => lastResponse,
  };
}

type AdapterCase = {
  name: string;
  invoke: (handler: (req: Request) => Promise<Response>) => Promise<Response>;
};

const adapterCases: AdapterCase[] = [
  {
    name: "next",
    invoke: async (handler) => {
      const { POST } = makeNextAdapter(handler);
      return POST(new Request("http://localhost/api/arivie", { method: "POST" }));
    },
  },
  {
    name: "hono",
    invoke: async (handler) => {
      const middleware = honoMiddleware({ handler });
      const request = new Request("http://localhost/api/arivie", { method: "POST" });
      const context = { req: { raw: request } } as Context;
      return middleware(context);
    },
  },
  {
    name: "bun",
    invoke: async (handler) => {
      const { fetch } = bunHandler({ handler });
      return fetch(new Request("http://localhost/api/arivie", { method: "POST" }));
    },
  },
  {
    name: "worker",
    invoke: async (handler) => {
      const { fetch } = workerHandler({ handler });
      return fetch(new Request("http://localhost/api/arivie", { method: "POST" }));
    },
  },
];

describe.each(adapterCases)("$name adapter", ({ invoke }) => {
  it("passes through SSE Response body and headers without re-buffering", async () => {
    const { handler, getLastResponse } = createSseHandler();
    const adapted = await invoke(handler);
    const fromHandler = getLastResponse();

    expect(fromHandler).toBeDefined();
    expect(adapted).toBe(fromHandler);
    expect(adapted.status).toBe(200);
    expect(adapted.headers.get("Content-Type")).toBe(SSE_CONTENT_TYPE);
    expect(adapted.headers.get("Cache-Control")).toBe("no-cache");
    expect(adapted.body).toBe(fromHandler!.body);
    await expect(adapted.text()).resolves.toBe(SSE_BODY);
  });
});
