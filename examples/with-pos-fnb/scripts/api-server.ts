/* SPDX-License-Identifier: Apache-2.0 */
import { serve } from "@hono/node-server";
import { createArivieServer } from "@arivie/core/server";
import { Hono } from "hono";
import { exampleRoot, loadEnv } from "./env.js";
import { runAnalystPrompt } from "./session-chat.js";

loadEnv();

const { arivie } = await import("../arivie.config.js");
const { app: arivieApp } = await createArivieServer(arivie, { rootDir: exampleRoot });

const app = new Hono();

app.get("/health", (c) =>
  c.json({ ok: true, service: "arivie-pos", model: process.env.OPENAI_MODEL ?? "gpt-5-mini" }),
);

app.post("/chat", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    message?: unknown;
    conversationId?: unknown;
    userId?: unknown;
  };
  if (typeof body.message !== "string" || body.message.length === 0) {
    return c.json({ error: "message is required" }, 400);
  }

  const userId = typeof body.userId === "string" && body.userId.length > 0 ? body.userId : "lumiere-cli";
  const conversationId =
    typeof body.conversationId === "string" && body.conversationId.length > 0
      ? body.conversationId
      : `cli:${userId}`;

  const answer = await runAnalystPrompt(arivie, {
    prompt: body.message,
    user: { userId, permissions: ["analytics:read", "ops:read"], dbRole: "arivie_reader" },
    conversationId,
    resourceId: userId,
  });

  return c.json({
    answer,
    conversationId,
  });
});

app.route("/", arivieApp);

const port = Number(process.env.PORT ?? 3000);
const server = serve({ fetch: app.fetch, port });
console.log(`[pos-fnb] API listening on http://localhost:${port}`);
console.log(`[pos-fnb] POST /chat or /api/agents/analyst/generate; channels at /channels/*`);

async function shutdown(signal: string): Promise<void> {
  console.log(`[pos-fnb] received ${signal}; shutting down`);
  await arivie.dispose();
  server.close(() => process.exit(0));
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
