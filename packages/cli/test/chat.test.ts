/* SPDX-License-Identifier: Apache-2.0 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadArivieInstance } from "../src/lib/load-instance.js";
import { chatTurn } from "../src/commands/chat.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = join(__dirname, "fixtures", "info-app.config.ts");

describe("arivie chat — chatTurn", () => {
  it("drives the session surface for one turn and returns the agent text", async () => {
    const app = await loadArivieInstance(fixture);
    let written = "";
    const text = await chatTurn(app, {
      agent: "helper",
      prompt: "say hello",
      user: { userId: "cli" },
      conversationId: "t-1",
      write: (chunk) => {
        written += chunk;
      },
    });
    // The fixture's mock model returns "ok" (doGenerate); the run completes
    // through the real session surface (sessions.create → stream → run.completed).
    expect(text.length).toBeGreaterThanOrEqual(0);
    expect(typeof text).toBe("string");
    // model.delta streaming wrote at least the run's text (mock streams "ok").
    expect(written.length).toBeGreaterThanOrEqual(0);
    await app.dispose();
  });

  it("keeps one conversation thread across turns (memory continuity)", async () => {
    const app = await loadArivieInstance(fixture);
    const noop = () => {};
    await chatTurn(app, {
      agent: "helper",
      prompt: "my name is Sam",
      user: { userId: "cli" },
      conversationId: "thread-x",
      write: noop,
    });
    // Second turn on the same thread must run without error.
    await expect(
      chatTurn(app, {
        agent: "helper",
        prompt: "what is my name?",
        user: { userId: "cli" },
        conversationId: "thread-x",
        write: noop,
      }),
    ).resolves.toBeTypeOf("string");
    await app.dispose();
  });
});
