/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { defineApp } from "../src/define-app.js";
import { definePlugin } from "../src/plugins/index.js";
import { defineAgent } from "../src/runtime/index.js";
import { InMemoryRuntimeStorage } from "../src/storage/index.js";
import type { ArivieEvent } from "../src/events/index.js";

async function collect(stream: ReadableStream<ArivieEvent>): Promise<ArivieEvent[]> {
  const out: ArivieEvent[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out.push(value);
  }
  return out;
}

function stubModel(text: string): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    provider: "mock",
    modelId: "mock",
    doGenerate: {
      content: [{ type: "text", text }],
      finishReason: "stop",
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      warnings: [],
    },
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: text },
          { type: "text-end", id: "t1" },
          {
            type: "finish",
            finishReason: { unified: "stop", raw: undefined },
            logprobs: undefined,
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, reasoning: undefined },
          },
        ],
      }),
    }),
  });
}

function demoPlugin() {
  return definePlugin({
    id: "demo",
    version: "1.0.0",
    capabilities: [
      { id: "demo.help", title: "Help", description: "General help capability." },
    ],
    setup: () => ({ instructions: "You are a concise demo assistant." }),
  })(undefined);
}

describe("defineApp — domain-neutral app builder", () => {
  it("compiles the manifest and exposes the plugin capability", async () => {
    const app = await defineApp({
      app: { id: "t", name: "T" },
      model: stubModel("ok"),
      storage: new InMemoryRuntimeStorage(),
      plugins: [demoPlugin()],
      agents: { helper: defineAgent({ instructions: "Be brief.", capabilities: ["demo.help"] }) },
      resolveUser: async () => ({ userId: "u1" }),
    });
    expect(app.manifest.capabilities.has("demo.help")).toBe(true);
    await app.dispose();
  });

  it("runs a session through the Mastra executor and streams a completed run", async () => {
    const app = await defineApp({
      app: { id: "t", name: "T" },
      model: stubModel("42 orders yesterday"),
      storage: new InMemoryRuntimeStorage(),
      plugins: [demoPlugin()],
      agents: { helper: defineAgent({ instructions: "Be brief.", capabilities: ["demo.help"] }) },
      resolveUser: async () => ({ userId: "u1" }),
    });

    const handle = await app.sessions.create({
      agent: "helper",
      prompt: "how many orders yesterday?",
      user: { userId: "u1" },
    });
    const events = await collect(handle.stream);
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("session.started");
    expect(types).toContain("run.completed");
    const completed = events.find((e) => e.type === "run.completed");
    expect((completed as { payload: { text?: string } }).payload.text).toContain("42 orders");
    await app.dispose();
  });

  it("rejects an unknown agent capability at build time", async () => {
    await expect(
      defineApp({
        app: { id: "t", name: "T" },
        model: stubModel("x"),
        storage: new InMemoryRuntimeStorage(),
        plugins: [demoPlugin()],
        agents: { bad: defineAgent({ instructions: "x", capabilities: ["nope"] }) },
        resolveUser: async () => ({ userId: "u1" }),
      }),
    ).rejects.toThrow();
  });

  it("serves POST /sessions over the HTTP handler", async () => {
    const app = await defineApp({
      app: { id: "t", name: "T" },
      model: stubModel("hello there"),
      storage: new InMemoryRuntimeStorage(),
      plugins: [demoPlugin()],
      agents: { helper: defineAgent({ instructions: "Be brief.", capabilities: ["demo.help"] }) },
      resolveUser: async () => ({ userId: "u1" }),
    });
    const res = await app.handler(
      new Request("http://local/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent: "helper", prompt: "hi" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("run.completed");
    await app.dispose();
  });
});
