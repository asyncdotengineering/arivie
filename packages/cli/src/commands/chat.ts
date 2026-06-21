/* SPDX-License-Identifier: Apache-2.0 */
import { randomUUID } from "node:crypto";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import type { ArivieApp, ArivieEvent, CreateSessionInput } from "@arivie/core";
import { defineCommand } from "citty";
import { loadArivieInstance } from "../lib/load-instance.js";

type ChatUser = CreateSessionInput["user"];

export interface ChatTurnOptions {
  agent: string;
  prompt: string;
  user: ChatUser;
  conversationId: string;
  /** Incremental output sink (model text deltas). */
  write: (chunk: string) => void;
  /** Called when the agent invokes a tool (e.g. SQL). */
  onTool?: (tool: string, args: Record<string, unknown>) => void;
}

/**
 * Run ONE chat turn against the deployed session surface: create a session for
 * the conversation thread, stream the structured events, write model deltas as
 * they arrive, surface tool calls, and return the terminal text. This dogfoods
 * the same path an HTTP client uses — no bespoke per-example runner.
 */
export async function chatTurn(app: ArivieApp, options: ChatTurnOptions): Promise<string> {
  const handle = await app.sessions.create({
    agent: options.agent,
    prompt: options.prompt,
    user: options.user,
    session: { id: options.conversationId },
  });

  const reader = handle.stream.getReader();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const event = value as ArivieEvent;
    switch (event.type) {
      case "model.delta":
        options.write(event.payload.text);
        break;
      case "tool.call.started":
        options.onTool?.(event.payload.tool, event.payload.args);
        break;
      case "run.completed":
        if (typeof event.payload.text === "string") text = event.payload.text;
        break;
      case "run.failed":
        options.write(`\n[error] ${event.payload.error.message}\n`);
        break;
      default:
        break;
    }
  }
  return text;
}

export interface RunChatOptions {
  agent?: string;
  user?: string;
  role?: string;
  conversation?: string;
}

const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

/**
 * Interactive terminal chat against any Arivie app — the canonical runner.
 * Loads the app, picks an agent, and loops over the deployed session surface,
 * keeping a single conversation thread so Mastra Memory continuity holds.
 */
export async function runChat(configPath: string, options: RunChatOptions = {}): Promise<number> {
  const app = await loadArivieInstance(configPath);
  const agents = Object.keys(app.runtime.agents);
  const agent = options.agent ?? agents[0];
  if (agent === undefined) {
    console.error("✗ No agents defined in this app.");
    await app.dispose();
    return 1;
  }
  if (!agents.includes(agent)) {
    console.error(`✗ Unknown agent "${agent}". Available: ${agents.join(", ")}`);
    await app.dispose();
    return 1;
  }

  const user: ChatUser = {
    userId: options.user ?? "cli",
    permissions: [],
    ...(options.role !== undefined ? { dbRole: options.role } : {}),
  };
  const conversationId = options.conversation ?? `cli-${randomUUID()}`;

  console.log(
    `${DIM}arivie chat — app "${app.app.name}" · agent "${agent}" · thread ${conversationId}\nType /exit to quit.${RESET}`,
  );

  const rl = createInterface({ input, output });
  let closed = false;
  rl.on("close", () => {
    closed = true;
  });
  try {
    for (;;) {
      if (closed) break;
      let line: string;
      try {
        line = (await rl.question("\n› ")).trim();
      } catch {
        // stdin reached EOF (piped input) or the interface was closed (Ctrl-D).
        break;
      }
      if (line === "/exit" || line === "/quit") break;
      if (line.length === 0) continue;
      await chatTurn(app, {
        agent,
        prompt: line,
        user,
        conversationId,
        write: (chunk) => output.write(chunk),
        onTool: (tool, args) =>
          output.write(`${DIM}⚙ ${tool} ${JSON.stringify(args)}${RESET}\n`),
      });
      output.write("\n");
    }
  } finally {
    rl.close();
    await app.dispose();
  }
  return 0;
}

export const chatCommand = defineCommand({
  meta: {
    name: "chat",
    description: "Interactive terminal chat against the app (drives the session API)",
  },
  args: {
    config: { type: "string", description: "Path to arivie.config.ts", default: "./arivie.config.ts" },
    agent: { type: "string", description: "Agent id (defaults to the first defined agent)" },
    user: { type: "string", description: "User id for the turn", default: "cli" },
    role: { type: "string", description: "DB role the agent's queries run as (e.g. arivie_reader)" },
    conversation: { type: "string", description: "Conversation/thread id (defaults to a fresh one)" },
  },
  async run({ args }) {
    const code = await runChat(args.config as string, {
      ...(args.agent !== undefined ? { agent: args.agent as string } : {}),
      ...(args.user !== undefined ? { user: args.user as string } : {}),
      ...(args.role !== undefined ? { role: args.role as string } : {}),
      ...(args.conversation !== undefined ? { conversation: args.conversation as string } : {}),
    });
    // A REPL owns its lifecycle: exit explicitly so a background framework timer
    // (Mastra's internal interval) doesn't keep the process alive after /exit.
    process.exit(code);
  },
});
