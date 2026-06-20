---
rfc: hono-triggers
part: 01-problem-background
---

# 1. Problem Statement

Arivie today is a single-agent analytics runtime with a custom HTTP handler. Three gaps prevent it from being a deployable, event-driven agent platform:

1. **No composable HTTP server.** `defineArivie` returns a raw `(req: Request) => Promise<Response>` handler and a Hono app that blindly forwards every route to that handler (`packages/core/src/define.ts:327-328`). There is no way to mount Mastra's REST surface, add provider webhooks, or apply middleware without hand-writing a host-specific wrapper.

2. **No event trigger abstraction.** Arivie has cron schedules (`packages/core/src/schedules.ts:35`) that generate Mastra scheduled workflows, but it cannot receive inbound events from Slack, GitHub, Stripe, or generic webhooks. Users must write separate Workers/servers outside Arivie.

3. **No target-aware build command.** The CLI has `dev`, `deploy`, `eval`, and `mcp` (`packages/cli/src/cli.ts:31-41`) but no `build --target node|cloudflare`. Operators cannot compile a project into a self-contained Node server or a Cloudflare Worker artifact.

Success means:
- Arivie exposes a Hono sub-app (`arivie()`) that composes with user-owned Hono apps and middleware.
- Mastra's agent/workflow HTTP surface is available through `@mastra/hono` under the same prefix.
- Users define triggers, channels, and subscriptions in config-driven files and Arivie routes inbound events to agents/workflows/skills.
- `arivie build --target node` produces `dist/server.mjs`; `arivie build --target cloudflare` produces a Worker artifact.
- All changes are driven by failing tests first (TDD); `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm eval` remain green.

---

# 2. Background

## 2.1 Current Arivie web surface

`packages/core/src/define.ts:321-328` constructs `makeWebHandler` and wraps it in a Hono app:

```ts
const handler = makeWebHandler({ agent, db: storage, config: parsed });
const honoApp = new Hono();
honoApp.all("*", async (c) => handler(c.req.raw));
```

`makeWebHandler` (`packages/core/src/handler.ts:190`) is a bespoke endpoint that:
- Verifies owner identity once at startup (`handler.ts:191-200`).
- Parses a JSON body with `messages`, resolves the user via `ArivieConfig.resolveUser`, and streams the agent response as SSE.
- Supports only the `/api` catch-all path; there is no workflow route, no agent metadata route, no OpenAPI.

This design was correct for the first cut (single analytics agent, SSE chat), but it does not scale to events, multiple agents, or workflows.

## 2.2 Mastra already uses Hono

Mastra's default server and `@mastra/hono` adapter are Hono-based. The adapter exposes `MastraServer`, which registers Mastra's `/api/agents/:agentId/...`, `/api/workflows/...`, and other routes onto an existing Hono app (`server-adapters/hono/src/index.ts`). Arivie can therefore adopt Hono without adding a foreign runtime — it is the same substrate Mastra already chose.

Mastra also has chat channels via `@chat-adapter/*` (Slack, Discord, Telegram, Teams, Linear, GChat) and a Slack provider package (`channels/slack/src/index.ts`). However, Mastra channels are chat-conversation adapters, not a generic webhook trigger model. Arivie needs a model that works for both chat providers and arbitrary provider webhooks (GitHub, Stripe, custom).

## 2.3 Flue's precedent

Flue (`.research/flue`) demonstrates the exact architecture Arivie should adopt:

- **Routing:** `packages/runtime/src/runtime/flue-app.ts:269-300` defines a mountable Hono sub-app `flue()` with routes for agents, workflows, runs, and channels. Users optionally provide `src/app.ts` and mount `flue()` explicitly (`docs/guide/routing/index.md`).
- **Channels:** `src/channels/<name>.ts` modules export a named `channel`. The channel package verifies the provider request and returns Hono responses. Routes are discovered and registered under `/channels/:name/:suffix` (`packages/runtime/src/runtime/flue-app.ts:594-635`).
- **Dispatch:** `dispatch(agent, { id, input })` delivers a verified event into a continuing agent session (`packages/runtime/src/runtime/dispatch.ts`).
- **Targets:** `packages/cli/src/lib/build-plugin-node.ts` and `build-plugin-cloudflare.ts` generate target-specific entry points. Node uses `@hono/node-server`; Cloudflare uses `@cloudflare/vite-plugin` and Durable Objects.

Arivie will follow this shape but replace Flue's agent/workflow runtime with Mastra's, since Arivie is already built on Mastra.

## 2.4 Why Hono

| Concern | Why Hono |
|---|---|
| Mastra alignment | `@mastra/hono` is a first-class adapter; Mastra's core server is Hono-based |
| Cross-runtime | Runs on Node (`@hono/node-server`), Cloudflare Workers, Deno, Bun, Fastly |
| Middleware | Auth, rate-limiting, CORS, logging compose before Arivie/Mastra routes |
| Sub-app routing | `app.route('/api', arivie())` matches both Flue and Mastra adapter patterns |
| Lightweight | Small, tree-shakeable dependency |

Arivie will not adopt Hono as a user-facing abstraction; users may optionally author `app.ts` with Hono. The framework will expose `arivie()` as a mountable Hono app for users who want full control, plus a pre-wired `arivie.handler` and `arivie.hono` for the simple case.
