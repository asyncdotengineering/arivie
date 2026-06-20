/* SPDX-License-Identifier: Apache-2.0 */
import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createGithubPushChannel, githubPushTrigger } from "../src/index.js";

function sign(payload: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(payload, "utf8").digest("hex")}`;
}

function makeContext({
  payload,
  signature,
  event,
  delivery,
}: {
  payload: string;
  signature?: string;
  event?: string;
  delivery?: string;
}) {
  const emitted: unknown[] = [];
  return {
    ctx: {
      c: {
        req: {
          header: (name: string) => {
            if (name === "x-hub-signature-256") return signature;
            if (name === "x-github-event") return event;
            if (name === "x-github-delivery") return delivery;
            return undefined;
          },
          text: async () => payload,
          raw: new Request("https://example.com/github/push"),
        },
        json: (body: unknown, status?: number) => ({ body, status }),
      },
      config: { webhookSecret: "secret" },
      emit: vi.fn(async (event: unknown) => {
        emitted.push(event);
      }),
    },
    emitted,
  };
}

describe("githubPushTrigger", () => {
  it("rejects requests without a signature", async () => {
    const route = githubPushTrigger.routes[0];
    const { ctx } = makeContext({ payload: "{}" });
    const result = await route.handler(ctx);
    expect(result).toEqual({ body: { error: "missing signature" }, status: 401 });
  });

  it("rejects requests with an invalid signature", async () => {
    const route = githubPushTrigger.routes[0];
    const { ctx } = makeContext({ payload: "{}", signature: "sha256=bad" });
    const result = await route.handler(ctx);
    expect(result).toEqual({ body: { error: "invalid signature" }, status: 401 });
  });

  it("emits a push event for a verified push payload", async () => {
    const payload = JSON.stringify({
      ref: "refs/heads/main",
      before: "abc",
      after: "def",
      repository: { full_name: "acme/app" },
      commits: [{ id: "c1", message: "init", author: { email: "a@b.com" } }],
    });
    const route = githubPushTrigger.routes[0];
    const { ctx, emitted } = makeContext({
      payload,
      signature: sign(payload, "secret"),
      event: "push",
      delivery: "d1",
    });
    const result = await route.handler(ctx);
    expect(result).toEqual({ body: { ok: true }, status: 200 });
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      type: "github.push",
      payload: {
        repository: "acme/app",
        ref: "refs/heads/main",
        before: "abc",
        after: "def",
        commits: [{ id: "c1", message: "init", author: "a@b.com" }],
      },
      metadata: {
        provider: "github",
        deliveryId: "d1",
      },
    });
  });
});

describe("createGithubPushChannel", () => {
  it("returns a configured channel", () => {
    const channel = createGithubPushChannel({ webhookSecret: "shh" });
    expect(channel.name).toBe("github.push");
    expect(channel.trigger.id).toBe("github.push");
    expect(channel.config).toEqual({ webhookSecret: "shh" });
  });
});
