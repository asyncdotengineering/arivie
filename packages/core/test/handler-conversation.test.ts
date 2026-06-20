/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it, vi } from "vitest";
import { makeWebHandler } from "../src/handler.js";
import type { ArivieConfig, StorageAdapter } from "../src/types.js";

function makeDb(): StorageAdapter {
  const sql = vi.fn(async () => [{ current_user: "arivie_reader", rolsuper: false }]);
  return {
    kind: "postgres",
    id: "test",
    url: "postgresql://localhost/test",
    sql,
    verifyOwnerIdentity: vi.fn(async () => undefined),
  } as unknown as StorageAdapter;
}

function makeConfig(): ArivieConfig {
  return {
    owner: { id: "owner", name: "Owner" },
    storage: makeDb(),
    model: {} as ArivieConfig["model"],
    semantic: { path: ".", mode: "preload" },
    sources: {},
    resolveUser: async () => ({
      userId: "user-1",
      permissions: ["analytics:read"],
      dbRole: "arivie_reader",
    }),
  };
}

describe("makeWebHandler conversation continuity", () => {
  it("maps conversation.id to Mastra memory thread and userId to resource", async () => {
    const generate = vi.fn(async () => ({ text: "ok" }));
    const handler = makeWebHandler({
      agent: { generate } as never,
      db: makeDb(),
      config: makeConfig(),
    });

    const res = await handler(
      new Request("https://arivie.test/api", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: "hello",
          conversation: { id: "conversation-123" },
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(generate).toHaveBeenCalledWith(
      [{ role: "user", content: "hello" }],
      {
        memory: { thread: "conversation-123", resource: "user-1" },
        abortSignal: expect.any(AbortSignal),
      },
    );
  });
});
