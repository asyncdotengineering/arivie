/* SPDX-License-Identifier: Apache-2.0 */
import type { ArivieInstance } from "../types.js";

/**
 * Bun.serve fetch handler — assigns the Arivie handler directly to `fetch`.
 * SSE streaming uses Bun's native Web `Response` / `ReadableStream` support
 * with no adapter-side transformation.
 */
export function bunHandler(
  arivie: Pick<ArivieInstance, "handler">,
): { fetch: (req: Request) => Promise<Response> } {
  return { fetch: arivie.handler };
}
