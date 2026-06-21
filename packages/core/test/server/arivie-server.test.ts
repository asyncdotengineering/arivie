/* SPDX-License-Identifier: Apache-2.0 */
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { arivie } from "../../src/server/index.js";
import { defineChannel } from "../../src/triggers/channel.js";
import { defineTrigger } from "../../src/triggers/define.js";
import type { ArivieApp } from "../../src/define-app.js";
import type { TriggerEvent } from "../../src/triggers/types.js";

function makeApp(): ArivieApp {
  const hono = new Hono();
  hono.get("/sessions", (c) => c.json({ runtime: "ok" }));
  return {
    hono,
    sessions: { create: vi.fn() },
  } as unknown as ArivieApp;
}

describe("arivie() server", () => {
  it("mounts runtime routes and Arivie channel routes under the same app", async () => {
    const trigger = defineTrigger<unknown, TriggerEvent>({
      id: "test",
      configSchema: undefined as never,
      routes: [
        {
          method: "POST",
          path: "/webhook",
          handler: async ({ c }) => c.json({ channel: "ok" }, 202),
        },
      ],
    });
    const channel = defineChannel({ name: "test", trigger, config: {} });

    const app = await arivie({ app: makeApp(), channels: [channel], subscriptions: [] });

    const runtimeRes = await app.request("/sessions");
    expect(runtimeRes.status).toBe(200);
    expect(await runtimeRes.json()).toEqual({ runtime: "ok" });

    const channelRes = await app.request("/channels/test/webhook", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "content-type": "application/json" },
    });
    expect(channelRes.status).toBe(202);
    const body = await channelRes.json();
    expect(body.channel).toBe("ok");
  });

  it("allows mounting under a user-owned prefix", async () => {
    const trigger = defineTrigger<unknown, TriggerEvent>({
      id: "test",
      configSchema: undefined as never,
      routes: [{ method: "GET", path: "/health", handler: async ({ c }) => c.text("ok") }],
    });
    const channel = defineChannel({ name: "test", trigger, config: {} });

    const root = new Hono();
    root.route("/api", await arivie({ app: makeApp(), channels: [channel], subscriptions: [] }));

    const res = await root.request("/api/channels/test/health");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });
});
