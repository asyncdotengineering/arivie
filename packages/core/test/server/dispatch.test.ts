/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it, vi } from "vitest";
import { dispatchEvent } from "../../src/server/dispatch.js";
import { defineChannel } from "../../src/triggers/channel.js";
import { defineSubscription } from "../../src/triggers/subscription.js";
import { defineTrigger } from "../../src/triggers/define.js";
import type { ArivieInstance } from "../../src/types.js";
import type { TriggerEvent } from "../../src/triggers/types.js";

function makeInstance(): ArivieInstance {
  const generate = vi.fn().mockResolvedValue({ text: "ok" });
  const start = vi.fn().mockResolvedValue({ ok: true });
  const createRun = vi.fn().mockReturnValue({ start });

  return {
    mastra: {
      getAgent: vi.fn().mockReturnValue({ generate }),
      getWorkflow: vi.fn().mockReturnValue({ createRun }),
    },
  } as unknown as ArivieInstance;
}

describe("dispatchEvent", () => {
  const testTrigger = defineTrigger<unknown, TriggerEvent>({
    id: "test",
    configSchema: undefined as never,
    routes: [{ method: "POST", path: "/webhook", handler: async () => undefined }],
  });

  const channel = defineChannel({
    name: "github",
    trigger: testTrigger,
    config: {},
  });

  it("calls agent.generate with resolved instance id when target kind is agent", async () => {
    const instance = makeInstance();
    const sub = defineSubscription({
      source: channel,
      target: {
        kind: "agent",
        id: "arivie",
        instanceId: (event) => event.metadata.conversationKey ?? "default",
        input: (event) => ({ messages: [{ role: "user", content: (event.payload as { text: string }).text }] }),
      },
    });

    const event: TriggerEvent = {
      type: "github.issue.opened",
      payload: { text: "hello" },
      metadata: { provider: "github", conversationKey: "repo/1" },
    };

    await dispatchEvent(event, "github", instance, [sub]);

    expect(instance.mastra.getAgent).toHaveBeenCalledWith("arivie");
    const agent = instance.mastra.getAgent("arivie");
    expect(agent.generate).toHaveBeenCalledWith(
      { messages: [{ role: "user", content: "hello" }] },
      { memory: { thread: "repo/1", resource: "repo/1" } },
    );
  });

  it("calls workflow.createRun().start with inputData when target kind is workflow", async () => {
    const instance = makeInstance();
    const sub = defineSubscription({
      source: channel,
      target: { kind: "workflow", id: "triage", input: { issue: "#1" } },
    });

    const event: TriggerEvent = {
      type: "github.issue.opened",
      payload: {},
      metadata: { provider: "github" },
    };

    await dispatchEvent(event, "github", instance, [sub]);

    expect(instance.mastra.getWorkflow).toHaveBeenCalledWith("triage");
    const workflow = instance.mastra.getWorkflow("triage");
    expect(workflow.createRun).toHaveBeenCalled();
    const run = workflow.createRun();
    expect(run.start).toHaveBeenCalledWith({ inputData: { issue: "#1" } });
  });

  it("skips subscriptions whose filter returns false", async () => {
    const instance = makeInstance();
    const sub = defineSubscription({
      source: channel,
      filter: (event) => event.type === "github.pull_request.opened",
      target: { kind: "agent", id: "arivie" },
    });

    const event: TriggerEvent = {
      type: "github.issue.opened",
      payload: {},
      metadata: { provider: "github" },
    };

    await dispatchEvent(event, "github", instance, [sub]);
    expect(instance.mastra.getAgent).not.toHaveBeenCalled();
  });

  it("ignores subscriptions for other sources", async () => {
    const instance = makeInstance();
    const sub = defineSubscription({
      source: "slack",
      target: { kind: "agent", id: "arivie" },
    });

    const event: TriggerEvent = {
      type: "github.issue.opened",
      payload: {},
      metadata: { provider: "github" },
    };

    await dispatchEvent(event, "github", instance, [sub]);
    expect(instance.mastra.getAgent).not.toHaveBeenCalled();
  });

  it("defaults instanceId to conversationKey then 'default'", async () => {
    const instance = makeInstance();
    const sub = defineSubscription({
      source: channel,
      target: { kind: "agent", id: "arivie" },
    });

    const event: TriggerEvent = {
      type: "github.issue.opened",
      payload: {},
      metadata: { provider: "github", conversationKey: "repo/2" },
    };

    await dispatchEvent(event, "github", instance, [sub]);
    const agent = instance.mastra.getAgent("arivie");
    expect(agent.generate).toHaveBeenCalledWith(
      event.payload,
      { memory: { thread: "repo/2", resource: "repo/2" } },
    );
  });
});
