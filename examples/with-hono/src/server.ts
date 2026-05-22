/* SPDX-License-Identifier: Apache-2.0 */
import { serve } from "@hono/node-server";
import { app } from "./app";

const port = Number(process.env.PORT ?? 3000);

serve({ fetch: app.fetch, port }, () => {
  console.log(`with-hono listening on http://127.0.0.1:${port}`);
});
