/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { defineChannel } from "../../src/triggers/channel.js";
import { defineTrigger } from "../../src/triggers/define.js";
import type { TriggerEvent } from "../../src/triggers/types.js";

describe("defineChannel", () => {
  const testTrigger = defineTrigger<unknown, TriggerEvent>({
    id: "test",
    configSchema: undefined as never,
    routes: [
      {
        method: "POST",
        path: "/webhook",
        handler: async () => new Response("ok"),
      },
    ],
  });

  it("throws when name is empty", () => {
    expect(() =>
      defineChannel({ name: "", trigger: testTrigger, config: {} }),
    ).toThrow("Channel name must be a non-empty string");
  });

  it("throws when name contains /", () => {
    expect(() =>
      defineChannel({ name: "foo/bar", trigger: testTrigger, config: {} }),
    ).toThrow('Channel name must not contain "/": foo/bar');
  });

  it("returns the channel for valid input", () => {
    const channel = defineChannel({
      name: "github",
      trigger: testTrigger,
      config: { secret: "shh" },
    });
    expect(channel.name).toBe("github");
    expect(channel.trigger.id).toBe("test");
    expect(channel.config).toEqual({ secret: "shh" });
  });
});
