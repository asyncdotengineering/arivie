/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { defineTrigger } from "../../src/triggers/define.js";
import type { TriggerEvent } from "../../src/triggers/types.js";

describe("defineTrigger", () => {
  it("throws when a route path does not start with /", () => {
    expect(() =>
      defineTrigger({
        id: "bad",
        configSchema: undefined as never,
        routes: [
          {
            method: "POST",
            path: "webhook",
            handler: async () => undefined,
          },
        ],
      }),
    ).toThrow('Trigger "bad" route path must start with "/": webhook');
  });

  it("throws for an invalid HTTP method", () => {
    expect(() =>
      defineTrigger({
        id: "bad-method",
        configSchema: undefined as never,
        routes: [
          {
            method: "PATCH" as "POST",
            path: "/webhook",
            handler: async () => undefined,
          },
        ],
      }),
    ).toThrow('Trigger "bad-method" route has invalid method: PATCH');
  });

  it("returns the definition for valid routes", () => {
    const handler = async ({
      emit,
    }: {
      emit: (event: TriggerEvent) => Promise<void>;
    }) => {
      await emit({
        type: "test.event",
        payload: { ok: true },
        metadata: { provider: "test" },
      });
      return new Response("ok");
    };

    const trigger = defineTrigger({
      id: "test",
      configSchema: undefined as never,
      routes: [
        { method: "POST", path: "/webhook", handler },
        { method: "GET", path: "/health", handler: async () => new Response("ok") },
      ],
    });

    expect(trigger.id).toBe("test");
    expect(trigger.routes).toHaveLength(2);
    expect(trigger.routes[0].method).toBe("POST");
    expect(trigger.routes[0].path).toBe("/webhook");
    expect(trigger.routes[1].method).toBe("GET");
  });

  it("allows ALL as a method", () => {
    const trigger = defineTrigger({
      id: "all-methods",
      configSchema: undefined as never,
      routes: [{ method: "ALL", path: "/catchall", handler: async () => undefined }],
    });
    expect(trigger.routes[0].method).toBe("ALL");
  });
});
