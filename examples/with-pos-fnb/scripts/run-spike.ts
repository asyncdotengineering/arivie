/* SPDX-License-Identifier: Apache-2.0 */
import { createHmac } from "node:crypto";
import { createArivieServer } from "@arivie/core/server";
import { exampleRoot, loadEnv } from "./env.js";
import { runAnalystPrompt } from "./session-chat.js";

loadEnv();

const modelId = process.env.OPENAI_MODEL ?? "gpt-5-mini";
const { arivie } = await import("../arivie.config.js");
const { app } = await createArivieServer(arivie, { rootDir: exampleRoot });

const user = {
  userId: "lumiere-gm",
  permissions: ["analytics:read", "ops:read"],
  dbRole: "arivie_reader",
};

console.log(`[pos-fnb] model: ${modelId}`);

const stored = await runAnalystPrompt(arivie, {
  prompt:
    "Remember the codeword LUMIERE_PRIME for this conversation. Reply with exactly STORED and nothing else.",
  user,
  conversationId: "lumiere:gm:flash",
});
console.log(`[pos-fnb] continuity store: ${stored.trim()}`);

const recalled = await runAnalystPrompt(arivie, {
  prompt:
    "What codeword did I ask you to remember? Reply with exactly the codeword and nothing else.",
  user,
  conversationId: "lumiere:gm:flash",
});
console.log(`[pos-fnb] continuity recall: ${recalled.trim()}`);

const opsAlert = await app.request("/channels/ops-alert/closeout", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    outletId: "bistro",
    severity: "critical",
    message: "Void percentage breached the 2% target during yesterday's close.",
  }),
});
console.log(`[pos-fnb] ops alert status: ${opsAlert.status}`);
console.log(`[pos-fnb] ops alert body: ${await opsAlert.text()}`);

const githubPayload = JSON.stringify({
  ref: "refs/heads/main",
  before: "abc123",
  after: "def456",
  repository: { full_name: "lumiere/analytics" },
  commits: [
    {
      id: "def456",
      message: "Update tickets semantic layer",
      author: { email: "analytics@lumiere.example" },
    },
  ],
});
const secret = process.env.GITHUB_WEBHOOK_SECRET ?? "dev-secret";
const signature = `sha256=${createHmac("sha256", secret).update(githubPayload).digest("hex")}`;

const github = await app.request("/channels/github.push/push", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-github-event": "push",
    "x-github-delivery": "pos-fnb-delivery-1",
    "x-hub-signature-256": signature,
  },
  body: githubPayload,
});
console.log(`[pos-fnb] github push status: ${github.status}`);
console.log(`[pos-fnb] github push body: ${await github.text()}`);

await arivie.dispose();
