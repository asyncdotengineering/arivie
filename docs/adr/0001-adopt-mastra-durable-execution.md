# ADR 0001 — Adopt Mastra durable execution (evented agents + workflows)

**Status:** Accepted — backlogged for a focused build (not yet implemented)
**Date:** 2026-06-22
**Decision driver:** "Don't fight Mastra" — use Mastra's leaf primitives; keep Arivie's spine.

## Context

Arivie wraps Mastra in a durable runtime + plugin/dispatch/context framework. An
audit of which Mastra primitives Arivie uses surfaced that Arivie uses **zero
Mastra Workflows** and runs agents on Mastra's **default (in-memory,
non-durable) execution engine**. Three capability gaps follow:

1. **No durable suspend/resume** — so no human-in-the-loop, no **tool approval**
   for dangerous tools (`database.write`, `shell.execute`), no multi-step
   workflows.
2. **Hand-rolled event log** — `arivie_events` + padded cursors exist largely
   *because* the default engine isn't durable; Mastra's `EventedExecutionEngine`
   already provides a cursor-resumable stream (`observe(runId, { offset })`).
3. The dispatch `target.kind === "workflow"` slot routes to **nothing**.

### Spike finding — dispatch vs Mastra durable execution

| Capability | Arivie (hand-built) | Mastra durable |
|---|---|---|
| Webhook dedupe on admit | ✅ `ON CONFLICT (dedupe_key)` | ❌ background-tasks lack it |
| Dead-letter | ✅ | ❌ not explicit |
| Retry/backoff, lease | ✅ | ✅ |
| Cursor-resumable stream | ✅ custom | ✅ `observe(runId,{offset})` |
| **Durable suspend/resume** | ❌ | ✅ |
| Branching / parallel / cron multi-step | ❌ | ✅ workflows |

**Conclusion:** dispatch is **not** wholesale reinvention — its dedupe +
dead-letter beat Mastra background-tasks for the webhook front-door. Keep it.
The real gap is **durable suspend/resume**, which Mastra provides.

## Decision

**Keep dispatch as the durable webhook front-door. Adopt Mastra evented
execution + workflows for everything that needs durable suspend/resume,
branching, or multi-step.** (Leaf/spine: dispatch admission = Arivie's spine;
execution + suspend/resume = Mastra's leaf.)

## Verified API research (done — do not re-research)

- `createEventedAgent` / `createDurableAgent` from **`@mastra/core/agent/durable`** — wrap a regular `Agent`.
- Mastra instance needs **PubSub + Cache**: in-memory (`EventEmitterPubSub` + `InMemoryServerCache`) for single-process; **Redis** (`@mastra/redis`) for multi-instance.
- Durable stream: `eventedAgent.stream()` → `{ runId, output, fullStream, cleanup }`; reconnect via `observe(runId, { offset })`.
- **De-risk blocker (found):** iterating the durable `output` throws `"output is not async iterable"` — it needs the PubSub/Cache pipeline wired first. **Resolve this before the executor rewrite.**
- Tool approval: `createTool({ requireApproval: true })` → stream emits `tool-call-approval` → `agent.approveToolCall({ runId })` / `declineToolCall`. Durable across processes once on the evented engine.
- Workflows: `createWorkflow` / `createStep` (`@mastra/core/workflows`), `schedule: { cron }`, `suspend` / `resume`.

## Implementation plan (tiny commits, each green)

1. Mastra instance: explicit in-memory PubSub + Cache (no-op for current path).
2. **Crux:** wrap agents with `createDurableAgent`; rewrite `packages/core/src/runtime/mastra-executor.ts` to consume `{ runId, output }` (resolve the not-async-iterable wiring) + accumulate terminal text from chunks. Verify all session/event tests + a streaming smoke.
3. **Tool approval (a2):** `requireApproval` on tools backed by dangerous permissions; executor maps `tool-call-approval` → `ApprovalRequested` event; session `approve`/`decline` → `approveToolCall`. Verify with a write-tool smoke.
4. **Workflows:** wire the empty `dispatch target.kind === "workflow"` slot to a real Mastra workflow; pos-fnb scheduled report as a multi-step workflow.

## Consequences

- **+** HITL / tool approval, multi-step + cron workflows, cross-process resumable streams.
- **+** `arivie_events` *could* later simplify onto Mastra's resumable streams (not required).
- **−** Touches the runtime executor (v2 core hot path); needs the PubSub/Cache pipeline solved + cross-process verification. **Best as a dedicated `/feature-build`, not a tail-of-session change.**
- Multi-instance durability needs Redis (`@mastra/redis`).

## Already shipped (related, standalone)

- `app.prompt()` durable one-shot — commit `6a07ded`.
- `POST /api/chat` useChat server via `@mastra/ai-sdk` — commit `bb8be27`.
- Input/output **processor guardrails** on agents — commit `be0258c`.
