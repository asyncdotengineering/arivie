/* SPDX-License-Identifier: Apache-2.0 */
import { serve } from "@hono/node-server";
import { createArivieServer } from "@arivie/core/server";
import { Hono } from "hono";
import { exampleRoot, loadEnv } from "./env.js";

loadEnv();

const { arivie } = await import("../arivie.config.js");
const { app: arivieApp } = await createArivieServer(arivie, { rootDir: exampleRoot });

const app = new Hono();

app.get("/health", (c) =>
  c.json({ ok: true, service: "arivie-woocommerce-orders-postgres", model: process.env.OPENAI_MODEL ?? "gpt-4o-mini" }),
);

app.post("/chat", async (c) => {
  const body = await c.req.json().catch(() => ({})) as {
    message?: unknown;
    conversationId?: unknown;
    userId?: unknown;
  };
  if (typeof body.message !== "string" || body.message.length === 0) {
    return c.json({ error: "message is required" }, 400);
  }

  const userId = typeof body.userId === "string" && body.userId.length > 0 ? body.userId : "woocommerce-analyst";
  const conversationId = typeof body.conversationId === "string" && body.conversationId.length > 0
    ? body.conversationId
    : `woocommerce:${userId}`;

  const result = await arivie.ask({
    prompt: body.message,
    user: { userId, permissions: ["analytics:read", "finance:read"], dbRole: "arivie_reader" },
    conversation: { id: conversationId, resource: process.env.ARIVIE_OWNER_ID ?? "woocommerce-demo-store" },
  });

  return c.json({
    answer: result.text,
    conversationId,
    toolCalls: result.toolCalls,
    sql: result.sql,
    artifacts: result.artifacts,
  });
});

app.route("/", arivieApp);

const port = Number(process.env.PORT ?? 3000);
const server = serve({ fetch: app.fetch, port });
console.log(`[woocommerce] API listening on http://localhost:${port}`);
console.log("[woocommerce] POST /chat or /api/agents/arivie/generate");

async function shutdown(signal: string): Promise<void> {
  console.log(`[woocommerce] received ${signal}; shutting down`);
  await arivie.dispose();
  server.close(() => process.exit(0));
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
