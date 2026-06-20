/* SPDX-License-Identifier: Apache-2.0 */
import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core";
import { Hono } from "hono";
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { arivie } from "../../src/server/index.js";
import { defineChannel } from "../../src/triggers/channel.js";
import { defineTrigger } from "../../src/triggers/define.js";
import type { ArivieInstance } from "../../src/types.js";
import type { TriggerEvent } from "../../src/triggers/types.js";

function makeModel() {
  return new MockLanguageModelV3({
    provider: "mock",
    modelId: "mock",
    doGenerate: {
      content: [{ type: "text", text: "ok" }],
      finishReason: "stop",
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      warnings: [],
    },
  });
}

describe("arivie() server", () => {
  it("mounts Mastra agent routes and Arivie channel routes under the same app", async () => {
    const agent = new Agent({
      id: "arivie",
      name: "Arivie",
      instructions: "test",
      model: makeModel(),
    });
    const mastra = new Mastra({ agents: { arivie: agent } });

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

    const instance = { mastra } as unknown as ArivieInstance;
    const app = await arivie({ instance, channels: [channel], subscriptions: [] });

    // Mastra route (default /api prefix). POST with a minimal body should be routed.
    const mastraRes = await app.request("/api/agents/arivie/generate", {
      method: "POST",
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
      headers: { "content-type": "application/json" },
    });
    // Without valid memory/config it may 400/500, but it must be routed (not 404)
    expect(mastraRes.status).not.toBe(404);

    // Arivie channel route
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
    const agent = new Agent({ id: "arivie", name: "Arivie", instructions: "test", model: makeModel() });
    const mastra = new Mastra({ agents: { arivie: agent } });
    const trigger = defineTrigger<unknown, TriggerEvent>({
      id: "test",
      configSchema: undefined as never,
      routes: [{ method: "GET", path: "/health", handler: async ({ c }) => c.text("ok") }],
    });
    const channel = defineChannel({ name: "test", trigger, config: {} });
    const instance = { mastra } as unknown as ArivieInstance;

    const root = new Hono();
    root.route("/api", await arivie({ instance, channels: [channel], subscriptions: [] }));

    const res = await root.request("/api/channels/test/health");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });
});
