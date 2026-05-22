/* SPDX-License-Identifier: Apache-2.0 */
import type { ArivieInstance } from "../types.js";

/**
 * Next.js App Router route adapter — export `POST` from `route.ts`.
 * The handler's Web Standard `Response` (including SSE `ReadableStream`
 * bodies) is returned as-is; no re-buffering or platform-specific wrapping.
 */
export function makeNextAdapter(handler: ArivieInstance["handler"]): {
  POST: (req: Request) => Promise<Response>;
} {
  return { POST: handler };
}
