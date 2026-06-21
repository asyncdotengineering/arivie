/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import type { ArivieEvent } from "../../src/events/index.js";
import { compareCursors } from "../../src/events/index.js";
import {
  createRuntime,
  defineAgent,
  type AgentExecutor,
} from "../../src/runtime/index.js";
import { createSessionApp } from "../../src/server/routes/index.js";
import { InMemoryRuntimeStorage } from "../../src/storage/index.js";

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

function parseSSE(text: string): ArivieEvent[] {
  const events: ArivieEvent[] = [];
  for (const block of text.split("\n\n")) {
    if (block.trim().length === 0) continue;
    const dataLine = block.split("\n").find((line) => line.startsWith("data: "));
    if (dataLine !== undefined) {
      events.push(JSON.parse(dataLine.slice("data: ".length)) as ArivieEvent);
    }
  }
  return events;
}

function buildApp() {
  const storage = new InMemoryRuntimeStorage();
  const runtime = createRuntime({
    storage,
    agents: { analyst: defineAgent({ instructions: "Answer questions." }) },
    executor: happyExecutor,
  });
  return createSessionApp({
    runtime,
    resolveUser: () => ({ userId: "u1" }),
  });
}

describe("HTTP event replay routes", () => {
  it("POST /sessions streams SSE and GET /runs/:runId/events resumes after cursor", async () => {
    const app = buildApp();

    const createRes = await app.request("/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent: "analyst", prompt: "how many orders?" }),
    });
    expect(createRes.status).toBe(200);
    expect(createRes.headers.get("Content-Type")).toBe("text/event-stream");

    const createBody = await createRes.text();
    const createEvents = parseSSE(createBody);
    expect(createEvents.map((e) => e.type)).toEqual([
      "session.started",
      "run.started",
      "model.delta",
      "tool.call.started",
      "tool.call.completed",
      "run.completed",
    ]);

    const runId = createEvents[0]!.runId;
    const midCursor = createEvents.find((e) => e.type === "run.started")!.cursor;

    const replayRes = await app.request(
      `/runs/${runId}/events?cursor=${encodeURIComponent(midCursor)}`,
    );
    expect(replayRes.status).toBe(200);
    expect(replayRes.headers.get("Content-Type")).toBe("text/event-stream");

    const replayEvents = parseSSE(await replayRes.text());
    expect(replayEvents.map((e) => e.type)).toEqual([
      "model.delta",
      "tool.call.started",
      "tool.call.completed",
      "run.completed",
    ]);

    for (const event of replayEvents) {
      expect(compareCursors(event.cursor, midCursor)).toBeGreaterThan(0);
    }

    const replayCursors = replayEvents.map((e) => e.cursor);
    const createCursors = createEvents.map((e) => e.cursor);
    for (const cursor of replayCursors) {
      expect(createCursors.filter((c) => c === cursor)).toHaveLength(1);
    }
  });

  it("POST /sessions returns 400 for an unknown agent", async () => {
    const app = buildApp();
    const res = await app.request("/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent: "nope", prompt: "q" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/Unknown agent/);
  });
});
