# Arivie Kitchen Sink — Northstar Hospitality Ops Copilot

This is the broadest runnable Arivie example in the repo. It models a realistic restaurant-group operations copilot for **Northstar Hospitality**, a three-outlet F&B group that wants daily analytics, exception alerts, scheduled reports, and agent continuity across conversations.

## What This Demonstrates

- `defineArivie` with a real Postgres source and dedicated storage adapter.
- Semantic-layer YAML entities, measures, dimensions, segments, joins, and catalog metadata.
- SOP skills loaded from `skills/*/SKILL.md` with `skillsMode: "auto"`.
- `compileMetric` enabled for canonical metric SQL.
- Local workspace tools with bash enabled via `localWorkspace`.
- Lifecycle hooks for query/tool/memory observability.
- Schedules via `defineSchedules`.
- First-class `conversation` continuity on `arivie.ask()`.
- Hono server composition through `createArivieServer()`.
- Custom `defineTrigger` + `defineChannel` + `defineSubscription`.
- First-party `@arivie/github` webhook channel with signature verification.
- Channel subscriptions that dispatch events into the Arivie agent with separate conversation thread and resource owner.
- API-first chat endpoint for application clients.
- Terminal chat client that can start a new conversation or continue saved history.
- CLI build target through `arivie build --target node`.

## Prerequisites

- Node 20+
- pnpm 10+
- Local Postgres with `psql` and `createdb` on `PATH`
- `OPENAI_API_KEY` in either repo-root `.env` or `examples/kitchen-sink/.env.local`

## Setup

From the repo root:

```bash
pnpm install
pnpm --filter @arivie/example-kitchen-sink setup-db
```

`setup-db` creates `arivie_kitchen_sink` if needed, applies `db/schema.sql`, seeds realistic operating data, provisions `arivie_reader`, and writes the owner identity boundary row.

## Run

```bash
pnpm --filter @arivie/example-kitchen-sink spike
```

Expected output shape:

```text
[kitchen-sink] model: gpt-4o-mini
[kitchen-sink] continuity store: STORED
[kitchen-sink] continuity recall: NORTHSTAR_MARGIN
[kitchen-sink] ops alert status: 200
[kitchen-sink] github push status: 200
```

The exact model text can vary slightly, but the spike is designed to ask for exact sentinel responses so continuity is easy to verify.

## API-First Server

```bash
pnpm --filter @arivie/example-kitchen-sink api
```

The server exposes a direct app-facing chat endpoint alongside Mastra and Arivie routes:

```bash
curl -X POST http://localhost:3000/chat \
  -H 'content-type: application/json' \
  -d '{"message":"What was yesterday revenue by outlet?","conversationId":"gm:morning","userId":"northstar-gm"}'
```

- `GET /health` checks the server.
- `POST /chat` is the API-first chat endpoint.
- `POST /api/agents/arivie/generate` is the Mastra agent route.
- `POST /channels/ops-alert/closeout` is the custom POS closeout webhook.
- `POST /channels/github.push/push` is the signed GitHub push webhook.

## CLI Chat

Start the terminal client against the API server:

```bash
pnpm --filter @arivie/example-kitchen-sink chat -- --api http://localhost:3000
```

When the CLI opens, it lists saved conversations from `workspace/conversation-history.json`. Select a prior conversation to continue, or choose `n` to start a new one. Inside an active chat, type `/new` to switch to a fresh conversation without leaving the CLI.

For scripted runs, bypass the picker with an explicit conversation id:

```bash
pnpm --filter @arivie/example-kitchen-sink chat -- --api http://localhost:3000 --conversation gm:morning
```

For quick local demos without a running server, omit `--api` and the CLI loads the agent in-process:

```bash
pnpm --filter @arivie/example-kitchen-sink chat
```

## Build

```bash
pnpm --filter @arivie/example-kitchen-sink build:node
node examples/kitchen-sink/dist/server.mjs
```

The Node build emits a Hono/Mastra server artifact at `examples/kitchen-sink/dist/server.mjs`.

## Feature Map

| Feature | Where |
|---|---|
| Arivie config | `arivie.config.ts` |
| Postgres source/storage | `arivie.config.ts`, `db/schema.sql` |
| Semantic layer | `semantic/catalog.yml`, `semantic/entities/*.yml` |
| Skills | `skills/daily-ops-brief/SKILL.md`, `skills/margin-watch/SKILL.md` |
| Schedules | `arivie.config.ts` (`defineSchedules`) |
| Conversation continuity | `scripts/run-spike.ts` (`conversation: { id }`) |
| API chat | `scripts/api-server.ts` (`POST /chat`) |
| CLI chat history | `scripts/chat.ts`, `workspace/conversation-history.json` |
| Custom channel | `channels/ops-alert.ts` |
| GitHub channel | `channels/github.ts` |
| Subscriptions | `subscriptions/*.ts` |
| Hono server | `scripts/api-server.ts`, `scripts/run-spike.ts` (`createArivieServer`) |
| Node build target | `package.json` `build:node` script |

## Notes

- This example is intentionally local-first. It does not require cloud services beyond the OpenAI model call.
- The `ops-alert` channel simulates a POS closeout webhook. The GitHub channel simulates a signed `push` webhook that could represent analytics-code changes affecting the semantic layer.
- `limits.requireToolApproval` is configured for bash writes to demonstrate the policy surface, but the automated spike avoids approval-gated prompts so it can run unattended.
