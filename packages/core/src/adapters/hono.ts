/* SPDX-License-Identifier: Apache-2.0 */
import type { Context } from "hono";
import type { ArivieInstance } from "../types.js";

// [S0-fix-2 pi-#3] Import Context from hono directly rather than maintaining
// a local structural type. `hono` is an optional peer-dep; consumers using the
// hono adapter will already have it installed.
/**
 * Hono middleware that forwards `c.req.raw` to the Arivie handler.
 * SSE `Response` objects (including `ReadableStream` bodies) pass through
 * transparently via `c.req.raw` → handler → return value.
 */
export function honoMiddleware(
  arivie: Pick<ArivieInstance, "handler">,
): (c: Context) => Promise<Response> {
  return async (c) => arivie.handler(c.req.raw);
}
