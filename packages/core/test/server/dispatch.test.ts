/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it, vi } from "vitest";
import { dispatchEvent } from "../../src/server/dispatch.js";
import { defineChannel } from "../../src/triggers/channel.js";
import { defineSubscription } from "../../src/triggers/subscription.js";
import { defineTrigger } from "../../src/triggers/define.js";
import type { ArivieApp } from "../../src/define-app.js";
import type { TriggerEvent } from "../../src/triggers/types.js";

function makeApp(): ArivieApp {
  return {
    sessions: {
      create: vi.fn().mockResolvedValue({
        sessionId: "s1",
        runId: "r1",
        continuationToken: "t",
        stream: new ReadableStream(),
      }),
    },
  } as unknown as ArivieApp;
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
    const app = makeApp();
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

    await dispatchEvent(event, "github", app, [sub]);

    expect(app.sessions.create).toHaveBeenCalledWith({
      agent: "arivie",
      messages: [{ role: "user", content: "hello" }],
      session: { id: "repo/1", resource: "repo/1" },
      user: { userId: "repo/1", raw: event },
      metadata: { triggerType: "github.issue.opened", provider: "github" },
    });
  });

  it("rejects workflow targets because ArivieApp has no workflow dispatch surface", async () => {
    const app = makeApp();
    const sub = defineSubscription({
      source: channel,
      target: { kind: "workflow", id: "triage", input: { issue: "#1" } },
    });

    const event: TriggerEvent = {
      type: "github.issue.opened",
      payload: {},
      metadata: { provider: "github" },
    };

    await expect(dispatchEvent(event, "github", app, [sub])).rejects.toThrow(
      "Workflow subscription target not supported by ArivieApp",
    );
  });

  it("skips subscriptions whose filter returns false", async () => {
    const app = makeApp();
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

    await dispatchEvent(event, "github", app, [sub]);
    expect(app.sessions.create).not.toHaveBeenCalled();
  });

  it("ignores subscriptions for other sources", async () => {
    const app = makeApp();
    const sub = defineSubscription({
      source: "slack",
      target: { kind: "agent", id: "arivie" },
    });

    const event: TriggerEvent = {
      type: "github.issue.opened",
      payload: {},
      metadata: { provider: "github" },
    };

    await dispatchEvent(event, "github", app, [sub]);
    expect(app.sessions.create).not.toHaveBeenCalled();
  });

  it("defaults instanceId to conversationKey then 'default'", async () => {
    const app = makeApp();
    const sub = defineSubscription({
      source: channel,
      target: { kind: "agent", id: "arivie" },
    });

    const event: TriggerEvent = {
      type: "github.issue.opened",
      payload: {},
      metadata: { provider: "github", conversationKey: "repo/2" },
    };

    await dispatchEvent(event, "github", app, [sub]);
    expect(app.sessions.create).toHaveBeenCalledWith({
      agent: "arivie",
      messages: [{ role: "user", content: "{}" }],
      session: { id: "repo/2", resource: "repo/2" },
      user: { userId: "repo/2", raw: event },
      metadata: { triggerType: "github.issue.opened", provider: "github" },
    });
  });

  it("resolves memory resource separately from conversation thread", async () => {
    const app = makeApp();
    const sub = defineSubscription({
      source: channel,
      target: { kind: "agent", id: "arivie" },
    });

    const event: TriggerEvent = {
      type: "github.issue.opened",
      payload: { text: "hello" },
      metadata: {
        provider: "github",
        conversationKey: "repo/issue-7",
        resourceKey: "github-installation-42",
      },
    };

    await dispatchEvent(event, "github", app, [sub]);
    expect(app.sessions.create).toHaveBeenCalledWith({
      agent: "arivie",
      messages: [{ role: "user", content: JSON.stringify(event.payload) }],
      session: { id: "repo/issue-7", resource: "github-installation-42" },
      user: { userId: "github-installation-42", raw: event },
      metadata: { triggerType: "github.issue.opened", provider: "github" },
    });
  });

  it("lets subscription targets override resource id", async () => {
    const app = makeApp();
    const sub = defineSubscription({
      source: channel,
      target: {
        kind: "agent",
        id: "arivie",
        instanceId: "conversation-1",
        resourceId: (event) => `tenant:${event.metadata.provider}`,
      },
    });

    const event: TriggerEvent = {
      type: "github.issue.opened",
      payload: {},
      metadata: { provider: "github" },
    };

    await dispatchEvent(event, "github", app, [sub]);
    expect(app.sessions.create).toHaveBeenCalledWith({
      agent: "arivie",
      messages: [{ role: "user", content: "{}" }],
      session: { id: "conversation-1", resource: "tenant:github" },
      user: { userId: "tenant:github", raw: event },
      metadata: { triggerType: "github.issue.opened", provider: "github" },
    });
  });
});
