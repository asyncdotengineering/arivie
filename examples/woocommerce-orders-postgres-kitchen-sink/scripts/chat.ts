/* SPDX-License-Identifier: Apache-2.0 */
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { loadEnv } from "./env.js";

loadEnv();

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const apiUrl = argValue("--api") ?? process.env.ARIVIE_API_URL;
const conversationId = argValue("--conversation") ?? "woocommerce:merchant:daily";
const userId = argValue("--user") ?? "woocommerce-analyst";

async function askViaApi(message: string): Promise<string> {
  if (!apiUrl) throw new Error("apiUrl missing");
  const response = await fetch(new URL("/chat", apiUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, conversationId, userId }),
  });
  if (!response.ok) throw new Error(`API chat failed: ${response.status} ${await response.text()}`);
  const body = await response.json() as { answer?: unknown };
  return typeof body.answer === "string" ? body.answer : JSON.stringify(body);
}

let localArivie: Awaited<typeof import("../arivie.config.js")>["arivie"] | undefined;

async function askInProcess(message: string): Promise<string> {
  localArivie ??= (await import("../arivie.config.js")).arivie;
  const result = await localArivie.ask({
    prompt: message,
    user: { userId, permissions: ["analytics:read", "finance:read"], dbRole: "arivie_reader" },
    conversation: { id: conversationId, resource: process.env.ARIVIE_OWNER_ID ?? "woocommerce-demo-store" },
  });
  return result.text;
}

console.log("Arivie WooCommerce orders Postgres chat");
console.log(`conversation: ${conversationId}`);
console.log(apiUrl ? `mode: API ${apiUrl}` : "mode: in-process (pass --api http://localhost:3000 to use the API)");
console.log("Type /exit to quit.\n");

const rl = createInterface({ input, output });
try {
  for (;;) {
    const message = (await rl.question("you> ")).trim();
    if (message === "/exit" || message === "/quit") break;
    if (message.length === 0) continue;
    const answer = apiUrl ? await askViaApi(message) : await askInProcess(message);
    console.log(`arivie> ${answer.trim()}\n`);
  }
} finally {
  rl.close();
  if (localArivie) await localArivie.dispose();
}
