<div align="center">

<img src=".assets/logo.png" alt="Arivie chibi owl mascot" width="220" />

# Arivie

**An agent framework you own. Analytics is the flagship plugin.**

[![npm](https://img.shields.io/npm/v/%40arivie%2Fcore?label=%40arivie%2Fcore&color=0d9488)](https://www.npmjs.com/package/@arivie/core)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-0d9488.svg)](./LICENSE)
[![Status: alpha](https://img.shields.io/badge/status-alpha-fb923c)](#status)
[![Node ≥20](https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Wraps Mastra 1.45](https://img.shields.io/badge/wraps-mastra%201.45-fb923c)](https://mastra.ai)

</div>

> **Arivie** (pronounced *"ah-REE-vee"*, rhymes with *trivia*) is a TypeScript-first, source-available, self-host-first **agent framework**. The Tamil root *arivu* (அறிவு — *knowledge / intelligence*) is hidden inside the spelling.

Arivie wraps **Mastra** (agent runtime, memory, model, streaming, tools, MCP) and adds the **durable, pluggable application layer** a generic agent toolkit deliberately omits: a plugin SDK, durable sessions/runs/events, a webhook dispatch queue, a file-backed context layer, and first-class diagnostics. **Analytics** — text-to-SQL on a governed semantic layer — is the first-party flagship **plugin**, not the framework itself.

> Not sure where Arivie ends and Mastra begins? See [docs/adr/0002 — Arivie vs Mastra ownership](./docs/adr/0002-arivie-vs-mastra-ownership.md). One rule: **never rebuild a Mastra leaf** (agents, memory, model, streaming, guardrails, workflows); spend Arivie's code only on the durable/plugin spine.

## Streamed answer in one command

```bash
pnpm dlx @arivie/cli init my-agent && cd my-agent
# put OPENAI_API_KEY + DATABASE_URL in .env (auto-loaded), then:
pnpm exec arivie chat --config arivie.config.ts
```

`arivie chat` opens a terminal chat (Ink TUI) against your app — pick a past conversation or start a new one, ask a question, watch the agent run SQL and stream the answer. No web server, no UI wiring, no DB-role ceremony to *see it work*. That's the fast path; everything below is for building the real thing.

## The app — `defineArivie`

```ts
// arivie.config.ts
import { defineArivie, defineAgent } from "@arivie/core";
import { analytics } from "@arivie/plugin-analytics";
import { postgresRuntime, postgresSource } from "@arivie/plugin-postgres";
import { openai } from "@ai-sdk/openai";

export const arivie = await defineArivie({
  app: { id: "acme", name: "Acme" },
  model: openai("gpt-4o-mini"),
  storage: postgresRuntime({ url: process.env.DATABASE_URL! }),   // durable sessions/runs/events
  plugins: [
    analytics({
      semanticPath: "./semantic",
      mode: "preload",
      compileMetric: true,
      sources: {
        postgres: postgresSource({ url: process.env.DATABASE_URL!, readOnlyRole: "arivie_reader" }),
      },
    }),
  ],
  agents: {
    analyst: defineAgent({
      instructions: "Answer with concise, auditable SQL-backed analysis.",
      capabilities: ["analytics.query", "analytics.compile_metric"],
    }),
  },
  context: { root: "./semantic" },
  resolveUser: async () => ({ userId: "you", permissions: ["analytics:read"], dbRole: "arivie_reader" }),
});

export default arivie;
```

Run a single prompt to its answer — the durable one-shot over the session surface:

```ts
const text = await arivie.prompt({
  agent: "analyst",
  prompt: "What was last week's revenue per outlet?",
  user: { userId: "you", permissions: ["analytics:read"], dbRole: "arivie_reader" },
});
```

For streaming or full control use `arivie.sessions.create(...)` (durable, cursor-replayable events). For an ephemeral, non-durable call drop to Mastra's `agent.generate()`. The boundary is documented in [ADR 0002](./docs/adr/0002-arivie-vs-mastra-ownership.md).

## What the framework gives you

- 🔌 **Plugin SDK** — `definePlugin` contributes tools, context schemas, channels, schedules, routes, capabilities, and permissions. Analytics is just the first one.
- 🧱 **Durable runtime** — sessions, runs, and a **cursor-replayable event log**; `arivie info` prints the compiled manifest + diagnostics.
- 📡 **Webhook dispatch** — channels admit events to a persisted queue with **dedupe, retry, dead-letter, and leases** (multi-replica safe).
- 🛡️ **Guardrails** — drop Mastra processors (`PIIDetector`, `PromptInjectionDetector`, `ModerationProcessor`) onto any agent via `defineAgent({ inputProcessors })`.
- 💬 **Web chat, zero wiring** — `POST /api/chat` is built in (Mastra's `@mastra/ai-sdk` under the hood), so `@arivie/react`'s `ArivieChat` / Vercel `useChat` work against your app out of the box.
- 🦉 **Analytics plugin** — YAML semantic layer (measures, dimensions, segments, joins, hints) compiled to canonical SQL; `arivie_reader` read-only role + SELECT-only SQL guard; SOP **skills** (versioned Markdown playbooks).
- 🔗 **MCP at both ends** — Postgres + Mixpanel + any MCP server as sources, and `arivie mcp` exposes your agent to MCP clients (Claude Desktop, Cursor).

## Roadmap (designed + backlogged, not yet shipped)

See [ADR 0001 — adopt Mastra durable execution](./docs/adr/0001-adopt-mastra-durable-execution.md):

- **Tool approval / HITL** — `requireApproval` on dangerous tools, surfaced as an `ApprovalRequested` event, resumed via Mastra's tool-suspension.
- **Durable workflows** — multi-step + cron-scheduled analyses on Mastra workflows (the empty dispatch `workflow` target wired to a real workflow), with cross-process suspend/resume.

> Current `schedules` are single-prompt cron config — not yet Mastra multi-step workflows.

## Examples

`examples/` — all v2, all runnable:

| Example | What it shows |
|---|---|
| `with-pos-fnb` | **Flagship** — production F&B analytics: 17-entity semantic layer + channels, subscriptions, schedules, continuity, API server |
| `kitchen-sink` | The approachable feature tour |
| `woocommerce-…` | Commerce-domain analytics |
| `with-nextjs` | Minimal Next.js + `ArivieChat` on `/api/chat` |
| `with-arivie-chat` | Full deployable web chat app |

## Status

| | |
|---|---|
| Version | **`2.0.0`** — domain-neutral agent framework; analytics demoted to a first-party plugin |
| Packages | **17** published `@arivie/*` packages |
| Tests | full suite green via `pnpm -r test` |
| Maturity | **alpha** — APIs may shift; semver discipline applies |
| Runtime | Node ≥20 LTS; Bun supported on `core`/`cli` |
| License | Apache-2.0 |
| Docs | [arivie-docs.vercel.app](https://arivie-docs.vercel.app) · [`./docs/`](./docs/) |

## Architecture decisions

- [ADR 0001 — Adopt Mastra durable execution](./docs/adr/0001-adopt-mastra-durable-execution.md)
- [ADR 0002 — Arivie vs Mastra ownership](./docs/adr/0002-arivie-vs-mastra-ownership.md)
