/* SPDX-License-Identifier: Apache-2.0 */
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { defineChannel } from "../../src/triggers/channel.js";
import { defineTrigger } from "../../src/triggers/define.js";
import { makeChannelRouteHandler } from "../../src/server/channel-route.js";
import type { TriggerEvent } from "../../src/triggers/types.js";
import type { ArivieInstance } from "../../src/types.js";

describe("makeChannelRouteHandler", () => {
  const testTrigger = defineTrigger<{ secret: string }, TriggerEvent>({
    id: "test",
    configSchema: undefined as never,
    routes: [
      {
        method: "POST",
        path: "/webhook",
        handler: async ({ c, emit }) => {
          await emit({
            type: "test.event",
            payload: { hello: "world" },
            metadata: { provider: "test" },
          });
          return c.json({ ok: true }, 202);
        },
      },
      {
        method: "GET",
        path: "/health",
        handler: async ({ c }) => c.text("healthy"),
      },
    ],
  });

  const channel = defineChannel({
    name: "test",
    trigger: testTrigger,
    config: { secret: "shh" },
  });

  function fakeInstance(): ArivieInstance {
    return {
      mastra: {
        getAgent: vi.fn().mockReturnValue({ generate: vi.fn().mockResolvedValue({ text: "" }) }),
        getWorkflow: vi.fn(),
      },
    } as unknown as ArivieInstance;
  }

  function buildApp() {
    const app = new Hono();
    const handler = makeChannelRouteHandler({
      channels: [channel],
      subscriptions: [],
      instance: fakeInstance(),
    });
    app.all("/channels/:name", handler);
    app.all("/channels/:name/:suffix{.+}", handler);
    return app;
  }

  it("returns 404 for unknown channel", async () => {
    const app = buildApp();
    const res = await app.request("/channels/unknown/webhook", { method: "POST" });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("channel_not_found");
  });

  it("returns 405 for wrong method with allowed list", async () => {
    const app = buildApp();
    const res = await app.request("/channels/test/webhook", { method: "GET" });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
    const body = await res.json();
    expect(body.error).toBe("method_not_allowed");
  });

  it("returns 404 for unknown suffix", async () => {
    const app = buildApp();
    const res = await app.request("/channels/test/missing", { method: "POST" });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("route_not_found");
  });

  it("executes matched route and returns its response", async () => {
    const app = buildApp();
    const res = await app.request("/channels/test/webhook", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("exposes config to the handler", async () => {
    const cfgTrigger = defineTrigger<{ secret: string }, TriggerEvent>({
      id: "cfg",
      configSchema: undefined as never,
      routes: [
        {
          method: "GET",
          path: "/config",
          handler: async ({ c, config }) => c.json({ secret: (config as { secret: string }).secret }),
        },
      ],
    });
    const cfgChannel = defineChannel({ name: "cfg", trigger: cfgTrigger, config: { secret: "abc" } });
    const app = new Hono();
    const handler = makeChannelRouteHandler({ channels: [cfgChannel], subscriptions: [], instance: fakeInstance() });
    app.all("/channels/:name", handler);
    app.all("/channels/:name/:suffix{.+}", handler);
    const res = await app.request("/channels/cfg/config");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.secret).toBe("abc");
  });
});
