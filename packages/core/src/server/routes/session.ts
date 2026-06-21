/* SPDX-License-Identifier: Apache-2.0 */
import { Hono } from "hono";
import { ArivieConfigError } from "../../errors.js";
import { encodeSSE } from "../../events/encode.js";
import type { ArivieEvent } from "../../events/types.js";
import type { CreateSessionInput, Runtime, UserContext } from "../../runtime/index.js";

export interface SessionRoutesOptions {
  runtime: Runtime;
  resolveUser: (req: Request) => Promise<UserContext> | UserContext;
}

type CreateSessionBody = Omit<CreateSessionInput, "user">;

function sseResponse(stream: ReadableStream<ArivieEvent>): Response {
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const reader = stream.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(encoder.encode(encodeSSE(value)));
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

export function mountSessionRoutes(app: Hono, options: SessionRoutesOptions): Hono {
  app.post("/sessions", async (c) => {
    try {
      const body = await c.req.json<CreateSessionBody>();
      const user = await options.resolveUser(c.req.raw);
      const handle = await options.runtime.sessions.create({ ...body, user });
      return sseResponse(handle.stream);
    } catch (err) {
      if (err instanceof ArivieConfigError) {
        return c.json({ error: err.message }, 400);
      }
      throw err;
    }
  });

  app.get("/runs/:runId/events", (c) => {
    const runId = c.req.param("runId");
    const cursor = c.req.query("cursor");
    return sseResponse(options.runtime.events.stream(runId, cursor));
  });

  return app;
}

export function createSessionApp(options: SessionRoutesOptions): Hono {
  return mountSessionRoutes(new Hono(), options);
}
