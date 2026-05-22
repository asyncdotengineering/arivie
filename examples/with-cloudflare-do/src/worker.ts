/* SPDX-License-Identifier: Apache-2.0 */
import { ArivieDO } from "./do";
import type { ArivieWorkerEnv } from "../arivie.config";

export { ArivieDO };

export default {
  async fetch(
    request: Request,
    env: ArivieWorkerEnv & { ARIVIE_DO: DurableObjectNamespace },
  ): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/api/arivie") {
      return new Response("with-cloudflare-do — POST /api/arivie", { status: 200 });
    }
    if (request.signal.aborted) {
      return new Response("client disconnected", { status: 499 });
    }
    const id = env.ARIVIE_DO.idFromName("default");
    const stub = env.ARIVIE_DO.get(id);
    return stub.fetch(request);
  },
};
