/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import {
  ArivieEventSchema,
  compareCursors,
  decodeNDJSON,
  encodeNDJSON,
  encodeSSE,
  formatCursor,
  isArivieEvent,
  parseEvent,
  type ArivieEvent,
} from "../../src/events/index.js";

function evt<T extends ArivieEvent>(e: T): T {
  return e;
}

const SAMPLES: ArivieEvent[] = [
  evt({
    cursor: formatCursor(1),
    id: "e1",
    type: "session.started",
    sessionId: "s1",
    runId: "r1",
    timestamp: "2026-06-21T00:00:00.000Z",
    payload: { agentId: "analyst", userId: "u1" },
  }),
  evt({
    cursor: formatCursor(2),
    id: "e2",
    type: "run.started",
    sessionId: "s1",
    runId: "r1",
    timestamp: "2026-06-21T00:00:01.000Z",
    payload: { agentId: "analyst", input: "hello" },
  }),
  evt({
    cursor: formatCursor(3),
    id: "e3",
    type: "model.delta",
    sessionId: "s1",
    runId: "r1",
    timestamp: "2026-06-21T00:00:02.000Z",
    payload: { text: "thinking" },
  }),
  evt({
    cursor: formatCursor(4),
    id: "e4",
    type: "tool.call.started",
    sessionId: "s1",
    runId: "r1",
    timestamp: "2026-06-21T00:00:03.000Z",
    payload: { toolCallId: "tc1", tool: "execute", args: { sql: "select 1" } },
  }),
  evt({
    cursor: formatCursor(5),
    id: "e5",
    type: "tool.call.completed",
    sessionId: "s1",
    runId: "r1",
    timestamp: "2026-06-21T00:00:04.000Z",
    payload: { toolCallId: "tc1", tool: "execute", output: { rows: 1 } },
  }),
  evt({
    cursor: formatCursor(6),
    id: "e6",
    type: "artifact.written",
    sessionId: "s1",
    runId: "r1",
    timestamp: "2026-06-21T00:00:05.000Z",
    payload: { path: "report.md", bytes: 120 },
  }),
  evt({
    cursor: formatCursor(7),
    id: "e7",
    type: "approval.requested",
    sessionId: "s1",
    runId: "r1",
    timestamp: "2026-06-21T00:00:06.000Z",
    payload: { toolCallId: "tc2", tool: "shell", args: { argv: ["ls"] } },
  }),
  evt({
    cursor: formatCursor(8),
    id: "e8",
    type: "channel.event.received",
    sessionId: "s1",
    runId: "r1",
    timestamp: "2026-06-21T00:00:07.000Z",
    payload: { channel: "github", eventType: "push", deliveryId: "d1" },
  }),
  evt({
    cursor: formatCursor(9),
    id: "e9",
    type: "run.completed",
    sessionId: "s1",
    runId: "r1",
    timestamp: "2026-06-21T00:00:08.000Z",
    payload: { text: "done" },
  }),
  evt({
    cursor: formatCursor(10),
    id: "e10",
    type: "run.failed",
    sessionId: "s1",
    runId: "r1",
    timestamp: "2026-06-21T00:00:09.000Z",
    payload: { error: { message: "boom", name: "Error" } },
  }),
];

describe("event schema validation", () => {
  it("validates every public variant", () => {
    for (const sample of SAMPLES) {
      expect(() => parseEvent(sample)).not.toThrow();
      expect(isArivieEvent(sample)).toBe(true);
    }
    // All ten variants are exercised.
    expect(new Set(SAMPLES.map((s) => s.type)).size).toBe(10);
  });

  it("rejects a payload that does not match its declared type", () => {
    const bad = { ...SAMPLES[9], payload: { text: "not an error payload" } };
    expect(ArivieEventSchema.safeParse(bad).success).toBe(false);
    expect(isArivieEvent(bad)).toBe(false);
  });

  it("rejects an unknown event type", () => {
    const bad = { ...SAMPLES[0], type: "mystery", payload: {} };
    expect(isArivieEvent(bad)).toBe(false);
  });
});

describe("cursor ordering", () => {
  it("is monotonic and lexically comparable", () => {
    const cursors = [1, 2, 9, 10, 100, 1000].map(formatCursor);
    const sorted = [...cursors].sort(compareCursors);
    expect(sorted).toEqual(cursors);
    expect(compareCursors(formatCursor(2), formatCursor(10))).toBeLessThan(0);
  });

  it("rejects negative / non-integer sequences", () => {
    expect(() => formatCursor(-1)).toThrow(RangeError);
    expect(() => formatCursor(1.5)).toThrow(RangeError);
  });
});

describe("encoders", () => {
  it("NDJSON round-trips through decode", () => {
    for (const sample of SAMPLES) {
      const line = encodeNDJSON(sample);
      expect(line.endsWith("\n")).toBe(true);
      expect(decodeNDJSON(line.trimEnd())).toEqual(sample);
    }
  });

  it("SSE frame carries cursor as id and the type as event", () => {
    const frame = encodeSSE(SAMPLES[2]!);
    expect(frame).toContain(`id: ${SAMPLES[2]!.cursor}`);
    expect(frame).toContain("event: model.delta");
    expect(frame.endsWith("\n\n")).toBe(true);
    const data = frame
      .split("\n")
      .find((l) => l.startsWith("data: "))!
      .slice("data: ".length);
    expect(JSON.parse(data)).toEqual(SAMPLES[2]);
  });

  it("applies a redactor before serializing", () => {
    const redact = (e: ArivieEvent): ArivieEvent =>
      e.type === "tool.call.started"
        ? { ...e, payload: { ...e.payload, args: { sql: "[redacted]" } } }
        : e;
    const line = encodeNDJSON(SAMPLES[3]!, redact);
    expect(line).toContain("[redacted]");
    expect(line).not.toContain("select 1");
  });
});
