/* SPDX-License-Identifier: Apache-2.0 */

export interface ParsedSseBuffer {
  events: string[];
  remainder: string;
}

/** Split accumulated SSE bytes into complete `data:` payloads. */
export function parseSseBuffer(buffer: string): ParsedSseBuffer {
  const events: string[] = [];
  const parts = buffer.split("\n\n");
  const remainder = parts.pop() ?? "";

  for (const part of parts) {
    const lines = part.split("\n");
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        dataLines.push(line.slice(6));
      }
    }
    if (dataLines.length > 0) {
      events.push(dataLines.join("\n"));
    }
  }

  return { events, remainder };
}

export async function readSseStream(
  body: ReadableStream<Uint8Array>,
  onData: (payload: string) => void,
  signal: AbortSignal,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (signal.aborted) {
        await reader.cancel();
        return;
      }
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const { events, remainder } = parseSseBuffer(buffer);
      buffer = remainder;
      for (const event of events) {
        onData(event);
      }
    }

    if (buffer.length > 0) {
      const { events } = parseSseBuffer(`${buffer}\n\n`);
      for (const event of events) {
        onData(event);
      }
    }
  } finally {
    reader.releaseLock();
  }
}
