/* SPDX-License-Identifier: Apache-2.0 */
import { getArivieRuntime } from "../arivie.config";

const port = Number(process.env.PORT ?? 3000);

Bun.serve({
  port,
  fetch: async (req) => {
    const pathname = new URL(req.url).pathname;
    if (pathname === "/api/arivie") {
      const { arivie } = await getArivieRuntime();
      return arivie.handler(req);
    }
    return new Response("ok");
  },
});

console.log(`with-bun listening on http://127.0.0.1:${port}`);
