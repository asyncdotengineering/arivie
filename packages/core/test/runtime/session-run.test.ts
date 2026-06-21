/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import type { ArivieEvent } from "../../src/events/index.js";
import { InMemoryRuntimeStorage } from "../../src/storage/index.js";
import {
  createRuntime,
  decodeContinuation,
  defineAgent,
  type AgentExecutor,
} from "../../src/runtime/index.js";

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

const happyExecutor: AgentExecutor = async ({ session, emit }) => {
  await emit({ type: "model.delta", sessionId: session.id, payload: { text: "hello" } });
  await emit({
    type: "tool.call.started",
    sessionId: session.id,
    payload: { toolCallId: "t1", tool: "execute", args: { sql: "select 1" } },
  });
  await emit({
    type: "tool.call.completed",
    sessionId: session.id,
    payload: { toolCallId: "t1", tool: "execute", output: { rows: 1 } },
  });
  return { text: "final answer" };
};

describe("createRuntime — session/run admission", () => {
  it("persists a run and an ordered event stream, then completes", async () => {
    const storage = new InMemoryRuntimeStorage();
    let calls = 0;
    const executor: AgentExecutor = async (ctx) => {
      calls += 1;
      return happyExecutor(ctx);
    };
    const rt = createRuntime({
      storage,
      agents: { analyst: defineAgent({ instructions: "Answer questions." }) },
      executor,
    });

    const handle = await rt.sessions.create({
      agent: "analyst",
      prompt: "how many orders?",
      user: { userId: "u1" },
    });

    const events = await collect(handle.stream);
    expect(events.map((e) => e.type)).toEqual([
      "session.started",
      "run.started",
      "model.delta",
      "tool.call.started",
      "tool.call.completed",
      "run.completed",
    ]);
    expect(calls).toBe(1);

    const run = await storage.runs.get(handle.runId);
    expect(run?.status).toBe("completed");
    expect(run?.result).toEqual({ text: "final answer" });

    // cursors strictly increase
    const cursors = events.map((e) => e.cursor);
    expect([...cursors].sort()).toEqual(cursors);
  });

  it("resumes from a cursor, returning only later events", async () => {
    const storage = new InMemoryRuntimeStorage();
    const rt = createRuntime({
      storage,
      agents: { a: defineAgent({ instructions: "x" }) },
      executor: happyExecutor,
    });
    const handle = await rt.sessions.create({ agent: "a", prompt: "q", user: { userId: "u1" } });
    const all = await collect(handle.stream);
    const runStarted = all.find((e) => e.type === "run.started")!;

    const replay = await collect(rt.events.stream(handle.runId, runStarted.cursor));
    expect(replay.map((e) => e.type)).toEqual([
      "model.delta",
      "tool.call.started",
      "tool.call.completed",
      "run.completed",
    ]);
  });

  it("issues a continuation token decoding to the run id", async () => {
    const storage = new InMemoryRuntimeStorage();
    const rt = createRuntime({
      storage,
      agents: { a: defineAgent({ instructions: "x" }) },
      executor: happyExecutor,
    });
    const handle = await rt.sessions.create({ agent: "a", prompt: "q", user: { userId: "u1" } });
    await collect(handle.stream);
    expect(decodeContinuation(handle.continuationToken).runId).toBe(handle.runId);
  });

  it("emits run.failed and marks the run failed when the executor throws", async () => {
    const storage = new InMemoryRuntimeStorage();
    const rt = createRuntime({
      storage,
      agents: { a: defineAgent({ instructions: "x" }) },
      executor: async () => {
        throw new Error("boom");
      },
    });
    const handle = await rt.sessions.create({ agent: "a", prompt: "q", user: { userId: "u1" } });
    const events = await collect(handle.stream);
    const failed = events.find((e) => e.type === "run.failed");
    expect(failed).toBeDefined();
    expect((failed as { payload: { error: { message: string } } }).payload.error.message).toBe("boom");
    const run = await storage.runs.get(handle.runId);
    expect(run?.status).toBe("failed");
  });

  it("rejects an unknown agent and a missing user", async () => {
    const rt = createRuntime({
      storage: new InMemoryRuntimeStorage(),
      agents: { a: defineAgent({ instructions: "x" }) },
      executor: happyExecutor,
    });
    await expect(rt.sessions.create({ agent: "nope", user: { userId: "u1" } })).rejects.toThrow(/Unknown agent/);
    await expect(
      rt.sessions.create({ agent: "a", user: { userId: "" } }),
    ).rejects.toThrow(/userId is required/);
  });

  it("reuses an existing session id across runs", async () => {
    const storage = new InMemoryRuntimeStorage();
    const rt = createRuntime({
      storage,
      agents: { a: defineAgent({ instructions: "x" }) },
      executor: happyExecutor,
    });
    const h1 = await rt.sessions.create({ agent: "a", prompt: "one", session: { id: "sess" }, user: { userId: "u1" } });
    await collect(h1.stream);
    const h2 = await rt.sessions.create({ agent: "a", prompt: "two", session: { id: "sess" }, user: { userId: "u1" } });
    const events = await collect(h2.stream);
    expect(h1.sessionId).toBe("sess");
    expect(h2.sessionId).toBe("sess");
    // second run does NOT re-emit session.started
    expect(events.map((e) => e.type)).not.toContain("session.started");
    const runs = await storage.runs.listBySession("sess");
    expect(runs.length).toBe(2);
  });
});
