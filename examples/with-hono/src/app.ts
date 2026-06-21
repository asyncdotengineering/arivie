/* SPDX-License-Identifier: Apache-2.0 */
import { Hono } from "hono";
import { getArivieRuntime } from "../arivie.config";

const app = new Hono();

app.get("/", (c) => c.text("with-hono — POST /api/arivie"));

app.post("/api/arivie", async (c) => {
  const { arivie } = await getArivieRuntime();
  return arivie.handler(c.req.raw);
});

export { app };
