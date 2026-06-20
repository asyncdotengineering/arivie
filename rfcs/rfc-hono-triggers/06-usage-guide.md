# Usage Guide: Hono server, channels, and target builds

This guide covers the runtime and build surfaces introduced by RFC `rfc-hono-triggers`.

## Server composition

Arivie projects export an `arivie.config.ts` that is consumed by `defineArivie()`.
The returned `ArivieInstance` now exposes a mountable Hono sub-app via `.app`:

```ts
import { defineArivie } from "@arivie/core";
import { arivie } from "@arivie/core/server";

const instance = await defineArivie(config);
const app = await arivie({ instance });
```

`arivie()` does three things:

1. Registers Mastra's REST routes (`/api/agents/...`, `/api/workflows/...`) through
   `@mastra/hono`'s `MastraServer`.
2. Registers Arivie channel routes at `/channels/:name/:suffix`.
3. Dispatches matched events to the subscriptions configured for each channel.

## Channels and subscriptions

A **trigger** declares one or more HTTP routes and how to turn a request into an
Arivie event. A **channel** is a named, configured trigger. A **subscription**
wires a channel's events to an agent, workflow, or skill.

```ts
import { defineChannel, defineSubscription } from "@arivie/core/triggers";
import { githubPushTrigger } from "@arivie/github";

const githubChannel = defineChannel({
  name: "github.push",
  trigger: githubPushTrigger,
  config: { webhookSecret: process.env.GITHUB_WEBHOOK_SECRET! },
});

const pushSubscription = defineSubscription({
  source: githubChannel,
  target: { kind: "agent", id: "arivie" },
});
```

Arivie discovers `channels/` and `subscriptions/` directories automatically when
using `createArivieServer()`:

```ts
import { createArivieServer } from "@arivie/core/server";

const { app } = await createArivieServer(instance, { rootDir: process.cwd() });
```

## Trigger handlers

A route handler receives a `TriggerContext` with the Hono `Context`, the channel
`config`, and an `emit()` function. Handlers either return a `Response` or call
`emit()` and then return a `Response`.

```ts
import { defineTrigger } from "@arivie/core/triggers";

export const pingTrigger = defineTrigger({
  id: "ping",
  configSchema: z.object({ token: z.string() }),
  routes: [
    {
      method: "POST",
      path: "/ping",
      async handler({ c, config, emit }) {
        const auth = c.req.header("authorization");
        if (auth !== `Bearer ${config.token}`) {
          return c.json({ error: "unauthorized" }, 401);
        }
        const body = await c.req.json();
        await emit({ type: "ping", payload: body, metadata: { provider: "custom" } });
        return c.json({ ok: true });
      },
    },
  ],
});
```

## Building for deployment

```bash
# Node.js server
arivie build --target node
node dist/server.mjs

# Cloudflare Workers (skeleton, Worker entry generated)
arivie build --target cloudflare
```

The Node build produces `dist/server.mjs` that loads `arivie.config.ts`, runs
discovery, and serves the composed Hono app with `@hono/node-server`.

## GitHub channel

Install `@arivie/github` and add the channel:

```ts
import { createGithubPushChannel } from "@arivie/github";

export const github = createGithubPushChannel({
  webhookSecret: process.env.GITHUB_WEBHOOK_SECRET!,
});
```

Point a GitHub webhook at `/channels/github/push`. The channel verifies the
`X-Hub-Signature-256` signature before emitting `github.push` events.
