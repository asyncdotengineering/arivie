/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { InMemoryStore } from "@mastra/core/storage";
import { Memory } from "@mastra/memory";
import { listConversations } from "../../src/runtime/conversations.js";
import type { ArivieApp } from "../../src/define-app.js";

describe("listConversations", () => {
  it("lists a resource's threads newest-first from the app memory store", async () => {
    const store = new InMemoryStore();
    const memory = new Memory({ storage: store });
    await memory.saveThread({
      thread: {
        id: "older",
        resourceId: "gm",
        title: "Margin watch",
        createdAt: new Date("2026-06-01T00:00:00Z"),
        updatedAt: new Date("2026-06-01T00:00:00Z"),
      },
    });
    await memory.saveThread({
      thread: {
        id: "newer",
        resourceId: "gm",
        title: "Daily brief",
        createdAt: new Date("2026-06-02T00:00:00Z"),
        updatedAt: new Date("2026-06-02T00:00:00Z"),
      },
    });
    // Another resource's thread must not leak in.
    await memory.saveThread({
      thread: {
        id: "other",
        resourceId: "someone-else",
        title: "Not mine",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    const app = { memory: store } as unknown as ArivieApp;
    const convos = await listConversations(app, "gm");
    expect(convos.map((c) => c.id)).toEqual(["newer", "older"]);
    expect(convos[0]?.title).toBe("Daily brief");
    expect(convos.some((c) => c.id === "other")).toBe(false);
  });
});
