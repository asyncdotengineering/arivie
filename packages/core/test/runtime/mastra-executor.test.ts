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

/** A fake Mastra agent: records the user context and returns a canned response. */
function fakeAgent(seenUser: { dbRole?: string }): Agent {
  return {
    generate: async () => {
      const user = getCurrentUserContext();
      seenUser.dbRole = user?.dbRole;
      return {
        text: "the answer",
        response: {
          messages: [
            {
              content: [
                {
                  type: "tool-call",
                  toolCallId: "tc1",
                  toolName: "execute_warehouse",
                  input: { sql: "select 1" },
                },
                {
                  type: "tool-result",
                  toolCallId: "tc1",
                  toolName: "execute_warehouse",
                  output: { rows: [{ n: 1 }] },
                },
              ],
            },
          ],
        },
      };
    },
  } as unknown as Agent;
}

describe("createMastraExecutor", () => {
  it("runs the agent under user context and emits tool-call events + text", async () => {
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
      "run.completed",
    ]);
    const completed = events.find((e) => e.type === "run.completed");
    expect((completed as { payload: { text?: string } }).payload.text).toBe("the answer");
    const started = events.find((e) => e.type === "tool.call.started");
    expect((started as { payload: { tool: string } }).payload.tool).toBe("execute_warehouse");
    // The owner-boundary user context was set for the tools.
    expect(seen.dbRole).toBe("arivie_reader");
    const run = await storage.runs.get(handle.runId);
    expect(run?.status).toBe("completed");
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
