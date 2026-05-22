/* SPDX-License-Identifier: Apache-2.0 */
import type { ArivieInstance, ExportedHandler } from "../types.js";

/**
 * Cloudflare Worker `ExportedHandler` — `fetch` delegates to the Arivie handler.
 * Workers runtimes natively support Web Standard `Response` with `ReadableStream`
 * bodies; SSE passes through without adapter-specific streaming setup.
 *
 * @see https://developers.cloudflare.com/workers/runtime-apis/streams/
 */
export function workerHandler(
  arivie: Pick<ArivieInstance, "handler">,
): ExportedHandler {
  return {
    fetch(request) {
      return arivie.handler(request);
    },
  };
}
