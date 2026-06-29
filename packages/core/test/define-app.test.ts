/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { InMemoryStore } from "@mastra/core/storage";
import type { Processor } from "@mastra/core/processors";
import { defineArivie } from "../src/define-app.js";
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

describe("defineArivie — domain-neutral app builder", () => {
  it("compiles the manifest and exposes the plugin capability", async () => {
    const app = await defineArivie({
      app: { id: "t", name: "T" },
      model: stubModel("ok"),
      storage: new InMemoryRuntimeStorage(),
      memory: new InMemoryStore(),
      plugins: [demoPlugin()],
      agents: { helper: defineAgent({ instructions: "Be brief.", capabilities: ["demo.help"] }) },
      resolveUser: async () => ({ userId: "u1" }),
    });
    expect(app.manifest.capabilities.has("demo.help")).toBe(true);
    await app.dispose();
  });

  it("runs a session through the Mastra executor and streams a completed run", async () => {
    const app = await defineArivie({
      app: { id: "t", name: "T" },
      model: stubModel("42 orders yesterday"),
      storage: new InMemoryRuntimeStorage(),
      memory: new InMemoryStore(),
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

  it("app.prompt runs one prompt to completion, streams onText, and returns the terminal text", async () => {
    const app = await defineArivie({
      app: { id: "t", name: "T" },
      model: stubModel("42 orders yesterday"),
      storage: new InMemoryRuntimeStorage(),
      memory: new InMemoryStore(),
      plugins: [demoPlugin()],
      agents: { helper: defineAgent({ instructions: "Be brief.", capabilities: ["demo.help"] }) },
      resolveUser: async () => ({ userId: "u1" }),
    });

    const chunks: string[] = [];
    const text = await app.prompt({
      agent: "helper",
      prompt: "how many orders yesterday?",
      user: { userId: "u1" },
      onText: (c) => chunks.push(c),
    });
    expect(text).toContain("42 orders");
    expect(chunks.join("")).toContain("42 orders"); // streamed via onText
    await app.dispose();
  });

  it("wires input-processor guardrails: an abort blocks the turn, a normal turn passes", async () => {
    // A minimal Mastra input processor that trips the guardrail on a keyword.
    const guardrail: Processor = {
      id: "blockword",
      processInput(args) {
        if (JSON.stringify(args.messages).includes("BLOCKME")) {
          args.abort("blocked by guardrail");
        }
        return args.messages;
      },
    };
    const app = await defineArivie({
      app: { id: "t", name: "T" },
      model: stubModel("safe answer"),
      storage: new InMemoryRuntimeStorage(),
      memory: new InMemoryStore(),
      plugins: [demoPlugin()],
      agents: {
        helper: defineAgent({
          instructions: "Be brief.",
          capabilities: ["demo.help"],
          inputProcessors: [guardrail],
        }),
      },
      resolveUser: async () => ({ userId: "u1" }),
    });

    // Normal turn passes the guardrail.
    const ok = await app.prompt({ agent: "helper", prompt: "hello", user: { userId: "u1" } });
    expect(ok).toContain("safe answer");

    // The guardrail aborts the blocked turn — it must NOT reach the model answer.
    let blocked = "";
    let threw = false;
    try {
      blocked = await app.prompt({
        agent: "helper",
        prompt: "BLOCKME now",
        user: { userId: "u1" },
      });
    } catch {
      threw = true;
    }
    expect(threw || !blocked.includes("safe answer")).toBe(true);
    await app.dispose();
  });

  it("rejects an unknown agent capability at build time", async () => {
    await expect(
      defineArivie({
        app: { id: "t", name: "T" },
        model: stubModel("x"),
        storage: new InMemoryRuntimeStorage(),
      memory: new InMemoryStore(),
        plugins: [demoPlugin()],
        agents: { bad: defineAgent({ instructions: "x", capabilities: ["nope"] }) },
        resolveUser: async () => ({ userId: "u1" }),
      }),
    ).rejects.toThrow();
  });

  it("wires Mastra Memory keyed to the session (two turns in one session both complete)", async () => {
    const app = await defineArivie({
      app: { id: "t", name: "T" },
      model: stubModel("noted"),
      storage: new InMemoryRuntimeStorage(),
      memory: new InMemoryStore(),
      plugins: [demoPlugin()],
      agents: { helper: defineAgent({ instructions: "Be brief.", capabilities: ["demo.help"] }) },
      resolveUser: async () => ({ userId: "u1" }),
      // no `memory` → defaults to Mastra's InMemoryStore; thread = session id
    });

    const first = await app.sessions.create({
      agent: "helper",
      prompt: "my name is Sam",
      session: { id: "conv-1" },
      user: { userId: "u1" },
    });
    expect((await collect(first.stream)).some((e) => e.type === "run.completed")).toBe(true);

    // Second turn in the SAME session/thread — must run through Mastra Memory
    // without error (the continuity primitive is wired, not bypassed).
    const second = await app.sessions.create({
      agent: "helper",
      prompt: "what is my name?",
      session: { id: "conv-1" },
      user: { userId: "u1" },
    });
    const events = await collect(second.stream);
    expect(events.some((e) => e.type === "run.completed")).toBe(true);
    expect(events.some((e) => e.type === "run.failed")).toBe(false);
    await app.dispose();
  });

  it("calls plugin dispose hooks on app.dispose (no resource leak)", async () => {
    let disposed = false;
    const leaky = definePlugin({
      id: "leaky",
      version: "1.0.0",
      capabilities: [{ id: "leaky.cap", title: "Leaky", description: "Holds a pool." }],
      setup: () => ({
        instructions: "x",
        dispose: () => {
          disposed = true;
        },
      }),
    })(undefined);

    const app = await defineArivie({
      app: { id: "t", name: "T" },
      model: stubModel("ok"),
      storage: new InMemoryRuntimeStorage(),
      memory: new InMemoryStore(),
      plugins: [leaky],
      agents: { helper: defineAgent({ instructions: "x", capabilities: ["leaky.cap"] }) },
      resolveUser: async () => ({ userId: "u1" }),
    });
    expect(disposed).toBe(false);
    await app.dispose();
    expect(disposed).toBe(true);
  });

  it("serves POST /sessions over the HTTP handler", async () => {
    const app = await defineArivie({
      app: { id: "t", name: "T" },
      model: stubModel("hello there"),
      storage: new InMemoryRuntimeStorage(),
      memory: new InMemoryStore(),
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

describe("defineArivie — context delivery guard", () => {
  async function appWithKnowledge(frontmatter: string): Promise<string[]> {
    const dir = await mkdtemp(join(tmpdir(), "arivie-ctx-"));
    await writeFile(join(dir, "policy.md"), `${frontmatter}\nPolicy body.\n`);
    const warnings: string[] = [];
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation((msg: unknown) => {
        warnings.push(String(msg));
      });
    const app = await defineArivie({
      app: { id: "t", name: "T" },
      model: stubModel("ok"),
      storage: new InMemoryRuntimeStorage(),
      memory: new InMemoryStore(),
      context: { root: dir },
      plugins: [demoPlugin()],
      agents: { helper: defineAgent({ instructions: "Be brief.", capabilities: ["demo.help"] }) },
      resolveUser: async () => ({ userId: "u1" }),
    });
    warnSpy.mockRestore();
    await app.dispose();
    await rm(dir, { recursive: true, force: true });
    return warnings;
  }

  it("warns when knowledge is usage_mode auto but no retriever is configured", async () => {
    const warnings = await appWithKnowledge("---\ntype: playbook\ntitle: P\ndescription: d\n---");
    expect(
      warnings.some((w) => w.includes('usage_mode "auto"') && w.includes("policy")),
    ).toBe(true);
  });

  it("does not warn when knowledge is usage_mode always", async () => {
    const warnings = await appWithKnowledge(
      "---\ntype: playbook\nusage_mode: always\ntitle: P\ndescription: d\n---",
    );
    expect(warnings.some((w) => w.includes('usage_mode "auto"'))).toBe(false);
  });
});
