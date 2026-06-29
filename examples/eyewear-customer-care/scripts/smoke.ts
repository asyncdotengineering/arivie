/* SPDX-License-Identifier: Apache-2.0 */
import { InMemoryRuntimeStorage } from "@arivie/core";
import { bootstrapEyewearPglite } from "./bootstrap-pglite.js";

const SAMPLE_PROMPT =
  "Hi, where is the refund for my order 1003? — jane@example.com";

if (!process.env.OPENAI_API_KEY) {
  console.log(
    "[eyewear-smoke] skipped — set OPENAI_API_KEY to run a live grounded draft.",
  );
  process.exit(0);
}

const { adapter, cleanup: cleanupDb } = await bootstrapEyewearPglite();
// Satisfy the eager config import; its URL source is overridden by the injected
// PGlite adapter below, so this URL is never actually connected to.
process.env.DATABASE_URL ??= adapter.url;

const { createArivie } = await import("../arivie.config.js");
const arivie = await createArivie({
  source: adapter,
  storage: new InMemoryRuntimeStorage(),
});

let draft = "";
try {
  draft = await arivie.prompt({
    agent: "care",
    prompt: SAMPLE_PROMPT,
    user: {
      userId: "smoke-tester",
      permissions: ["analytics:read"],
      dbRole: "arivie_reader",
    },
    session: { id: "eyewear-smoke", resource: "smoke-tester" },
  });
} finally {
  await arivie.dispose?.();
  await cleanupDb();
}

const trimmed = draft.trim();
if (trimmed.length === 0) {
  console.error("[eyewear-smoke] empty draft");
  process.exit(1);
}

console.log("--- DRAFT ---");
console.log(trimmed);
