/* SPDX-License-Identifier: Apache-2.0 */
// The "Ship It" step: Northwind Analytics as an HTTP API — no web UI.
// Mounts Arivie's surface: POST /sessions, GET /runs/:id/events?cursor=,
// and POST /api/chat (Vercel AI SDK useChat-compatible).
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { arivie } from "./arivie.config.js";

const app = new Hono();
app.get("/health", (c) => c.json({ ok: true, app: "northwind" }));
app.route("/", arivie.hono);

const port = Number(process.env.PORT ?? 3000);
const server = serve({ fetch: app.fetch, port });
console.log(`[northwind] API on http://localhost:${port}`);
console.log(`[northwind] POST /sessions · GET /runs/:id/events · POST /api/chat`);

async function shutdown(): Promise<void> {
  await arivie.dispose();
  server.close(() => process.exit(0));
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
