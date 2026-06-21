/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import type { Agent } from "@mastra/core/agent";
import { getCurrentUserContext } from "../../src/context.js";
import { InMemoryRuntimeStorage } from "../../src/storage/index.js";
import type { ArivieEvent } from "../../src/events/index.js";
import { createRuntime, defineAgent } from "../../src/runtime/index.js";
import { createMastraExecutor } from "../../src/runtime/mastra-executor.js";

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

/**
 * A fake Mastra agent exposing the streaming surface the executor uses
 * (`agent.stream(...).fullStream` + `.text`). Records the user context that
 * was active when the stream ran, and emits a tool call + a text delta.
 */
function fakeAgent(seenUser: { dbRole?: string }): Agent {
  const chunks = [
    {
      type: "tool-call",
      payload: { toolCallId: "tc1", toolName: "execute_warehouse", args: { sql: "select 1" } },
    },
    {
      type: "tool-result",
      payload: { toolCallId: "tc1", toolName: "execute_warehouse", result: { rows: [{ n: 1 }] } },
    },
    { type: "text-delta", payload: { text: "the answer" } },
    { type: "finish", payload: {} },
  ];
  return {
    stream: async () => {
      seenUser.dbRole = getCurrentUserContext()?.dbRole;
      return {
        fullStream: (async function* () {
          for (const chunk of chunks) yield chunk;
        })(),
        text: Promise.resolve("the answer"),
      };
    },
  } as unknown as Agent;
}

describe("createMastraExecutor (streaming)", () => {
  it("streams chunks to structured events under the user context", async () => {
    const storage = new InMemoryRuntimeStorage();
    const seen: { dbRole?: string } = {};
    const rt = createRuntime({
      storage,
      agents: { analyst: defineAgent({ instructions: "Answer." }) },
      executor: createMastraExecutor({ agents: { analyst: fakeAgent(seen) } }),
    });

    const handle = await rt.sessions.create({
      agent: "analyst",
      prompt: "how many?",
      user: { userId: "u1", permissions: ["read"], dbRole: "arivie_reader" },
    });
    const events = await collect(handle.stream);

    expect(events.map((e) => e.type)).toEqual([
      "session.started",
      "run.started",
      "tool.call.started",
      "tool.call.completed",
      "model.delta",
      "run.completed",
    ]);
    const started = events.find((e) => e.type === "tool.call.started");
    expect((started as { payload: { tool: string } }).payload.tool).toBe("execute_warehouse");
    const delta = events.find((e) => e.type === "model.delta");
    expect((delta as { payload: { text: string } }).payload.text).toBe("the answer");
    const completed = events.find((e) => e.type === "run.completed");
    expect((completed as { payload: { text?: string } }).payload.text).toBe("the answer");
    // The owner-boundary user context was set for the tools.
    expect(seen.dbRole).toBe("arivie_reader");
    expect((await storage.runs.get(handle.runId))?.status).toBe("completed");
  });

  it("throws when no Mastra agent is registered for the run's agent id", async () => {
    const storage = new InMemoryRuntimeStorage();
    const rt = createRuntime({
      storage,
      agents: { ghost: defineAgent({ instructions: "x" }) },
      executor: createMastraExecutor({ agents: {} }),
    });
    const handle = await rt.sessions.create({
      agent: "ghost",
      prompt: "q",
      user: { userId: "u1" },
    });
    const events = await collect(handle.stream);
    expect(events.some((e) => e.type === "run.failed")).toBe(true);
  });
});
