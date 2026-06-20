/* SPDX-License-Identifier: Apache-2.0 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { exampleRoot, loadEnv } from "./env.js";

loadEnv();

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const apiUrl = argValue("--api") ?? process.env.ARIVIE_API_URL;
const suppliedConversationId = argValue("--conversation");
const userId = argValue("--user") ?? "northstar-gm";
const historyPath = join(exampleRoot, "workspace", "conversation-history.json");

interface ConversationHistoryEntry {
  id: string;
  title: string;
  updatedAt: string;
}

function readHistory(): ConversationHistoryEntry[] {
  if (!existsSync(historyPath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(historyPath, "utf8"));
    return Array.isArray(parsed)
      ? parsed.filter(
          (entry): entry is ConversationHistoryEntry =>
            entry != null &&
            typeof entry === "object" &&
            typeof entry.id === "string" &&
            typeof entry.title === "string" &&
            typeof entry.updatedAt === "string",
        )
      : [];
  } catch {
    return [];
  }
}

function writeHistory(history: ConversationHistoryEntry[]): void {
  mkdirSync(join(exampleRoot, "workspace"), { recursive: true });
  writeFileSync(historyPath, `${JSON.stringify(history.slice(0, 25), null, 2)}\n`);
}

function rememberConversation(history: ConversationHistoryEntry[], id: string, firstMessage?: string): void {
  const title = firstMessage == null || firstMessage.length === 0
    ? id
    : firstMessage.length > 60
      ? `${firstMessage.slice(0, 57)}...`
      : firstMessage;
  const existing = history.find((entry) => entry.id === id);
  if (existing) {
    existing.updatedAt = new Date().toISOString();
    if (existing.title === existing.id && firstMessage) existing.title = title;
  } else {
    history.unshift({ id, title, updatedAt: new Date().toISOString() });
  }
  history.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  writeHistory(history);
}

async function chooseConversation(rl: ReturnType<typeof createInterface>): Promise<string> {
  if (suppliedConversationId) return suppliedConversationId;
  const history = readHistory();
  if (history.length === 0) {
    const id = `cli:${userId}:${new Date().toISOString().replace(/[:.]/g, "-")}`;
    rememberConversation(history, id);
    return id;
  }

  console.log("Saved conversations:");
  history.slice(0, 9).forEach((entry, index) => {
    console.log(`${index + 1}. ${entry.title} (${entry.id})`);
  });
  console.log("n. Start a new conversation");
  const choice = (await rl.question("Select conversation [1]: ")).trim();
  if (choice === "" || choice === "1") return history[0]?.id ?? `cli:${userId}`;
  if (choice.toLowerCase() === "n") {
    const title = (await rl.question("Title: ")).trim();
    const slug = (title || "conversation").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const id = `cli:${userId}:${slug || Date.now()}`;
    rememberConversation(history, id, title || id);
    return id;
  }
  const selected = history[Number(choice) - 1];
  return selected?.id ?? history[0]?.id ?? `cli:${userId}`;
}

async function askViaApi(message: string, conversationId: string): Promise<string> {
  if (!apiUrl) throw new Error("apiUrl missing");
  const response = await fetch(new URL("/chat", apiUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, conversationId, userId }),
  });
  if (!response.ok) {
    throw new Error(`API chat failed: ${response.status} ${await response.text()}`);
  }
  const body = (await response.json()) as { answer?: unknown };
  return typeof body.answer === "string" ? body.answer : JSON.stringify(body);
}

let localArivie: Awaited<typeof import("../arivie.config.js")>["arivie"] | undefined;

async function askInProcess(message: string, conversationId: string): Promise<string> {
  localArivie ??= (await import("../arivie.config.js")).arivie;
  const result = await localArivie.ask({
    prompt: message,
    user: {
      userId,
      permissions: ["analytics:read", "ops:read"],
      dbRole: "arivie_reader",
    },
    conversation: { id: conversationId, resource: userId },
  });
  return result.text;
}

const rl = createInterface({ input, output });
try {
  let conversationId = await chooseConversation(rl);
  console.log("\nArivie kitchen-sink chat");
  console.log(`conversation: ${conversationId}`);
  console.log(apiUrl ? `mode: API ${apiUrl}` : "mode: in-process (pass --api http://localhost:3000 to use the API)");
  console.log("Type /new to start a new conversation. Type /exit to quit.\n");

  for (;;) {
    const message = (await rl.question("you> ")).trim();
    if (message === "/exit" || message === "/quit") break;
    if (message === "/new") {
      const title = (await rl.question("Title: ")).trim();
      const id = `cli:${userId}:${(title || `conversation-${Date.now()}`).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
      rememberConversation(readHistory(), id, title || id);
      conversationId = id;
      console.log(`Started ${id}.\n`);
      continue;
    }
    if (message.length === 0) continue;
    rememberConversation(readHistory(), conversationId, message);
    const answer = apiUrl ? await askViaApi(message, conversationId) : await askInProcess(message, conversationId);
    console.log(`arivie> ${answer.trim()}\n`);
  }
} finally {
  rl.close();
  if (localArivie) await localArivie.dispose();
}
