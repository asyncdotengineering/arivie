/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Deployed-surface eval (RFC C16, REQ-15): proves framework confidence through
 * the PUBLIC runtime surfaces, not internals — the HTTP session API, cursor
 * event replay, and channel dispatch (admit → worker → session). Self-contained
 * (in-memory storage + a mock model + a demo plugin); no Docker, no network.
 *
 * MCP and the GitHub channel are not yet wired into the new app builder (tracked
 * in the backlog), so they are out of scope here; REQ-15 is satisfied by driving
 * the runtime through these deployed surfaces.
 */
import { describe, expect, it } from "vitest";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { InMemoryStore } from "@mastra/core/storage";
import {
  admitChannelEvent,
  createDispatchWorker,
  defineAgent,
  defineArivie,
  definePlugin,
  InMemoryRuntimeStorage,
  type ArivieEvent,
} from "@arivie/core";

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
    capabilities: [{ id: "demo.help", title: "Help", description: "General help." }],
    setup: () => ({ instructions: "You are a concise assistant." }),
  })(undefined);
}

async function buildApp(answer: string) {
  const storage = new InMemoryRuntimeStorage();
  const app = await defineArivie({
    app: { id: "surface", name: "Surface Eval" },
    model: stubModel(answer),
    storage,
    memory: new InMemoryStore(),
    plugins: [demoPlugin()],
    agents: { helper: defineAgent({ instructions: "Be brief.", capabilities: ["demo.help"] }) },
    resolveUser: async () => ({ userId: "u1" }),
  });
  return { app, storage };
}

/** Parse SSE `data:` frames from an event-stream response body into events. */
function parseSse(body: string): ArivieEvent[] {
  return body
    .split("\n\n")
    .map((block) => block.split("\n").find((l) => l.startsWith("data: ")))
    .filter((l): l is string => l !== undefined)
    .map((l) => JSON.parse(l.slice("data: ".length)) as ArivieEvent);
}

describe("deployed-surface eval", () => {
  it("HTTP POST /sessions streams a structured, completed run", async () => {
    const { app } = await buildApp("42 orders");
    const res = await app.handler(
      new Request("http://local/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent: "helper", prompt: "how many orders?" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const events = parseSse(await res.text());
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("session.started");
    expect(types).toContain("run.completed");
    const completed = events.find((e) => e.type === "run.completed");
    expect((completed as { payload: { text?: string } }).payload.text).toContain("42 orders");
    await app.dispose();
  });

  it("HTTP GET /runs/:runId/events?cursor replays only events after the cursor", async () => {
    const { app } = await buildApp("done");
    const first = await app.handler(
      new Request("http://local/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent: "helper", prompt: "hi" }),
      }),
    );
    const events = parseSse(await first.text());
    const runStarted = events.find((e) => e.type === "run.started")!;
    const runId = runStarted.runId;

    const replayRes = await app.handler(
      new Request(`http://local/runs/${runId}/events?cursor=${runStarted.cursor}`),
    );
    expect(replayRes.status).toBe(200);
    const replay = parseSse(await replayRes.text());
    // Every replayed event is strictly after the cursor, and none is a re-run of
    // session.started / run.started.
    expect(replay.length).toBeGreaterThan(0);
    expect(replay.every((e) => e.cursor > runStarted.cursor)).toBe(true);
    expect(replay.some((e) => e.type === "session.started")).toBe(false);
    expect(replay.some((e) => e.type === "run.completed")).toBe(true);
    await app.dispose();
  });

  it("channel dispatch: admit → worker → durable session run", async () => {
    const { app, storage } = await buildApp("handled");

    // Admit a channel event into the persisted queue (idempotent by dedupe key).
    const admitted = await admitChannelEvent(storage, "demo-channel", {
      metadata: { deliveryId: "delivery-1" },
      payload: { question: "from the channel" },
    });
    expect(admitted.duplicate).toBe(false);

    // A worker drains the queue, mapping each message to a durable session run.
    const ranSessions: string[] = [];
    const worker = createDispatchWorker<string>({
      storage,
      workerId: "dispatch-1",
      resolveSubscriptions: () => ["helper"],
      dispatch: async (agentId, message) => {
        const payload = (message.event as { payload?: { question?: string } }).payload;
        const handle = await app.sessions.create({
          agent: agentId,
          prompt: payload?.question ?? "",
          user: { userId: "system" },
        });
        const reader = handle.stream.getReader();
        for (;;) {
          const { done } = await reader.read();
          if (done) break;
        }
        ranSessions.push(handle.runId);
      },
    });

    const result = await worker.tick();
    expect(result).toMatchObject({ claimed: 1, completed: 1 });
    expect(ranSessions).toHaveLength(1);

    const run = await storage.runs.get(ranSessions[0]!);
    expect(run?.status).toBe("completed");

    // Re-admitting the same delivery is deduped (admitted once, not re-run).
    const again = await admitChannelEvent(storage, "demo-channel", {
      metadata: { deliveryId: "delivery-1" },
      payload: { question: "from the channel" },
    });
    expect(again.duplicate).toBe(true);
    await app.dispose();
  });
});
