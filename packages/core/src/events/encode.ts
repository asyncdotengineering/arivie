/* SPDX-License-Identifier: Apache-2.0 */
import { ArivieEventSchema, type ArivieEvent } from "./types.js";

/**
 * Fixed-width zero-padded cursors so lexical ordering equals numeric ordering.
 * Storage assigns the sequence; clients resume strictly after a cursor (RFC
 * §6.4). 16 digits comfortably exceeds any realistic per-run event count.
 */
export const CURSOR_WIDTH = 16;

/** Format a monotonic sequence number as a comparable cursor string. */
export function formatCursor(seq: number): string {
  if (!Number.isInteger(seq) || seq < 0) {
    throw new RangeError(`cursor sequence must be a non-negative integer: ${seq}`);
  }
  return seq.toString().padStart(CURSOR_WIDTH, "0");
}

/** Compare two cursors. Returns <0, 0, or >0 (lexical == numeric ordering). */
export function compareCursors(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Validate an arbitrary value as a public {@link ArivieEvent} (RFC §4.7). */
export function parseEvent(value: unknown): ArivieEvent {
  return ArivieEventSchema.parse(value);
}

/** Type guard form of {@link parseEvent}. */
export function isArivieEvent(value: unknown): value is ArivieEvent {
  return ArivieEventSchema.safeParse(value).success;
}

/** Optional redaction applied before an event is serialized to a client (RFC §10.4). */
export type EventRedactor = (event: ArivieEvent) => ArivieEvent;

/** Encode an event as one NDJSON line (trailing newline). */
export function encodeNDJSON(event: ArivieEvent, redact?: EventRedactor): string {
  const out = redact ? redact(event) : event;
  return `${JSON.stringify(out)}\n`;
}

/**
 * Encode an event as a Server-Sent Events frame. `id:` carries the cursor so a
 * disconnecting client can resume via `Last-Event-ID`; `event:` carries the
 * type; `data:` carries the full event JSON.
 */
export function encodeSSE(event: ArivieEvent, redact?: EventRedactor): string {
  const out = redact ? redact(event) : event;
  return `id: ${out.cursor}\nevent: ${out.type}\ndata: ${JSON.stringify(out)}\n\n`;
}

/** Parse one NDJSON line back into a validated event (round-trip / replay). */
export function decodeNDJSON(line: string): ArivieEvent {
  return parseEvent(JSON.parse(line));
}
