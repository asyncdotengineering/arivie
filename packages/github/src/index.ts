/* SPDX-License-Identifier: Apache-2.0 */
import { defineChannel, defineTrigger } from "@arivie/core/triggers";
import type { TriggerEvent } from "@arivie/core/triggers";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const githubPushConfigSchema = z.object({
  webhookSecret: z.string().min(1),
});

export type GithubPushConfig = z.infer<typeof githubPushConfigSchema>;

export interface GithubPushPayload {
  repository: string | null;
  ref: string | null;
  before: string | null;
  after: string | null;
  commits: Array<{ id: string | null; message: string | null; author: string | null }>;
}

export type GithubPushEvent = TriggerEvent<"github.push", GithubPushPayload>;

function verifySignature(payload: string, signature: string, secret: string): boolean {
  const expected = `sha256=${createHmac("sha256", secret).update(payload, "utf8").digest("hex")}`;
  if (expected.length !== signature.length) {
    return false;
  }
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

/**
 * GitHub push-event trigger. Verifies `X-Hub-Signature-256` and emits a
 * trigger event with repository, ref, and commit metadata.
 */
export const githubPushTrigger = defineTrigger<GithubPushConfig, GithubPushEvent>({
  id: "github.push",
  configSchema: githubPushConfigSchema,
  routes: [
    {
      method: "POST",
      path: "/push",
      async handler(ctx) {
        const { c, emit } = ctx;
        const config = ctx.config as GithubPushConfig;
        const signature = c.req.header("x-hub-signature-256");
        if (!signature) {
          return c.json({ error: "missing signature" }, 401);
        }
        const payload = await c.req.text();
        if (!verifySignature(payload, signature, config.webhookSecret)) {
          return c.json({ error: "invalid signature" }, 401);
        }

        const event = c.req.header("x-github-event");
        if (event !== "push") {
          return c.json({ error: `unsupported event: ${event ?? "unknown"}` }, 400);
        }

        const body: {
          repository?: { full_name?: string };
          ref?: string;
          before?: string;
          after?: string;
          commits?: Array<{ id?: string; message?: string; author?: { email?: string } }>;
        } = JSON.parse(payload);
        const eventPayload: GithubPushPayload = {
          repository: body.repository?.full_name ?? null,
          ref: body.ref ?? null,
          before: body.before ?? null,
          after: body.after ?? null,
          commits: Array.isArray(body.commits)
            ? body.commits.map((commit) => ({
                id: commit.id ?? null,
                message: commit.message ?? null,
                author: commit.author?.email ?? null,
              }))
            : [],
        };
        await emit({
          type: "github.push",
          payload: eventPayload,
          metadata: {
            provider: "github",
            deliveryId: c.req.header("x-github-delivery") ?? undefined,
            rawRequest: c.req.raw,
          },
        });
        return c.json({ ok: true }, 200);
      },
    },
  ],
});

/**
 * Create a configured GitHub push channel for use with `createArivieServer`.
 */
export function createGithubPushChannel(config: GithubPushConfig) {
  return defineChannel({ name: "github.push", trigger: githubPushTrigger, config });
}
