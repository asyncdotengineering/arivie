/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { parseSseBuffer, readSseStream } from "../src/sse.js";

describe("sse", () => {
  it("parseSseBuffer extracts data payloads", () => {
    const buffer = "data: Hello \n\ndata: world\n\ndata: [DONE]\n\n";
    const { events } = parseSseBuffer(buffer);
    expect(events).toEqual(["Hello ", "world", "[DONE]"]);
  });

  it("readSseStream invokes onData for each event", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("data: one\n\n"));
        controller.enqueue(encoder.encode("data: two\n\n"));
        controller.close();
      },
    });
    const seen: string[] = [];
    await readSseStream(body, (data) => {
      seen.push(data);
    }, new AbortController().signal);
    expect(seen).toEqual(["one", "two"]);
  });
});
