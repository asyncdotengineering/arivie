/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { defineChannel } from "../../src/triggers/channel.js";
import { defineSubscription } from "../../src/triggers/subscription.js";
import { defineTrigger } from "../../src/triggers/define.js";
import type { TriggerEvent } from "../../src/triggers/types.js";

describe("defineSubscription", () => {
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

  const channel = defineChannel({
    name: "github",
    trigger: testTrigger,
    config: {},
  });

  it("returns the subscription with a channel source", () => {
    const sub = defineSubscription({
      source: channel,
      target: { kind: "agent", id: "arivie" },
    });
    expect(sub.source).toBe(channel);
    expect(sub.target.kind).toBe("agent");
    expect(sub.target.id).toBe("arivie");
  });

  it("returns the subscription with a string source", () => {
    const sub = defineSubscription({
      source: "github",
      filter: (event) => event.type === "github.issue.opened",
      target: { kind: "workflow", id: "triage" },
    });
    expect(sub.source).toBe("github");
    expect(sub.target.kind).toBe("workflow");
  });

  it("allows function instanceId and input resolvers", () => {
    const sub = defineSubscription({
      source: channel,
      target: {
        kind: "agent",
        id: "arivie",
        instanceId: (event) => event.metadata.conversationKey ?? "default",
        input: (event) => ({ messages: [{ role: "user", content: event.payload as string }] }),
      },
    });
    expect(typeof sub.target.instanceId).toBe("function");
    expect(typeof sub.target.input).toBe("function");
  });
});
