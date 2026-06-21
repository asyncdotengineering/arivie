/* SPDX-License-Identifier: Apache-2.0 */
import type { ArivieEvent } from "../events/types.js";
import type { RuntimeStorage } from "../storage/types.js";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A cursor-resumable event stream for a run (RFC §6.4). Reads events strictly
 * after `startCursor` in order, then polls until the run is terminal and the
 * log is fully drained. Because the executor appends the terminal `run.*`
 * event BEFORE flipping run status (see `run.ts`), this never closes without
 * delivering the terminal event.
 */
export function streamEvents(
  storage: RuntimeStorage,
  runId: string,
  startCursor: string | undefined,
  pollMs: number,
): ReadableStream<ArivieEvent> {
  let cursor = startCursor;
  return new ReadableStream<ArivieEvent>({
    async pull(controller) {
      while (true) {
        const batch = await storage.events.readAfter(runId, cursor, 100);
        if (batch.length > 0) {
          for (const event of batch) {
            controller.enqueue(event);
            cursor = event.cursor;
          }
          return;
        }
        const run = await storage.runs.get(runId);
        const terminal =
          run !== undefined &&
          (run.status === "completed" || run.status === "failed");
        if (terminal) {
          const tail = await storage.events.readAfter(runId, cursor, 100);
          if (tail.length > 0) {
            for (const event of tail) {
              controller.enqueue(event);
              cursor = event.cursor;
            }
            return;
          }
          controller.close();
          return;
        }
        await delay(pollMs);
      }
    },
  });
}

/** Encode (runId, cursor) into an opaque continuation token. */
export function encodeContinuation(
  runId: string,
  cursor: string | undefined,
): string {
  return Buffer.from(JSON.stringify({ runId, cursor: cursor ?? null })).toString(
    "base64url",
  );
}

/** Decode a continuation token back into (runId, cursor). */
export function decodeContinuation(token: string): {
  runId: string;
  cursor: string | undefined;
} {
  const parsed = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as {
    runId: string;
    cursor: string | null;
  };
  return { runId: parsed.runId, cursor: parsed.cursor ?? undefined };
}
