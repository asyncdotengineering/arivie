# ADR 0002 — Arivie vs Mastra: who owns what

**Status:** Accepted (standing reference)
**Date:** 2026-06-22
**Why this exists:** The single biggest product risk for Arivie is not features — it's **legibility of the boundary**. A developer who didn't help draw the line cannot tell where Arivie ends and Mastra begins, and hits choice overload (`app.prompt` *and* `agent.generate`, `/sessions` *and* `/api/chat`). This ADR is the canonical map.

## The principle: leaf / spine

> **Spine = Arivie.** The durable, pluggable application runtime Mastra deliberately does not provide.
> **Leaf = Mastra.** Agent execution, memory, model, streaming, guardrails, workflows. **Never rebuild a leaf.**

Spend Arivie's own code only on the spine. Route everything else to Mastra.

## Ownership table

| Concern | Owner | Concretely |
|---|---|---|
| Durable sessions / runs / **replayable event log** | **Arivie** | `sessions.create`, `/runs/:id/events?cursor=` |
| Plugin SDK (capabilities, permissions, manifest) | **Arivie** | `definePlugin`, `arivie info` |
| Channel **dispatch** (admit / **dedupe** / retry / **dead-letter** / lease) | **Arivie** | `arivie_dispatch_messages`, `FOR UPDATE SKIP LOCKED` |
| Context layer (file-backed executable + prose) | **Arivie** | `@arivie/context`, `defineContextLayer` |
| Analytics (semantic layer, SQL guard, read-only role) | **Arivie** (plugin) | `@arivie/plugin-analytics` |
| App composition + diagnostics + blueprints | **Arivie** | `defineArivie`, `defineAgent`, `arivie info` |
| — | — | — |
| Agent execution loop | **Mastra** | `new Agent(...)` (built inside `defineArivie`) |
| Conversation **memory** (thread/resource) | **Mastra** | `@mastra/memory`; Arivie wires session = thread |
| Model abstraction | **Mastra / AI SDK** | `model: openai(...)` |
| One-shot run (ephemeral) + streaming | **Mastra** | `agent.generate()` / `agent.stream()` |
| **useChat** server | **Mastra** | `@mastra/ai-sdk` → mounted at `POST /api/chat` |
| **Guardrails** (PII / prompt-injection / moderation) | **Mastra** | `@mastra/core/processors` via `defineAgent({ inputProcessors })` |
| Tools + **tool approval** | **Mastra** | `createTool`, `requireApproval` (backlogged: ADR 0001) |
| **Workflows** + durable suspend/resume | **Mastra** | `createWorkflow` / evented agents (backlogged: ADR 0001) |
| MCP client/server | **Mastra** | `@arivie/mcp` wraps `@mastra/mcp` |
| Storage adapters | **Mastra** | LibSQL / Postgres stores |

## The seam (where Arivie wraps Mastra)

- `defineArivie` builds Mastra `Agent`s **and** holds a `Mastra` instance (for `@mastra/ai-sdk`).
- `mastra-executor.ts` bridges Mastra's stream → Arivie's durable event log.
- `app.prompt()` = a **durable** one-shot over `sessions.create`; Mastra's `agent.generate()` = **ephemeral**.
- `/sessions` + `/runs/:id/events` = Arivie's **durable** HTTP protocol; `/api/chat` = Mastra **useChat**.

## "Do I use Arivie or Mastra for X?" — the 30-second answer

| I want to… | Use |
|---|---|
| Run a prompt, get an answer, don't care about durability | **Mastra** `agent.generate()` |
| Run a prompt as a **durable, replayable run** (audit / dispatch / resume) | **Arivie** `app.prompt()` / `sessions.create` |
| Build a **web chat UI** (`useChat` / `ArivieChat`) | **Arivie** `POST /api/chat` (mounts Mastra's handler) |
| Add a **guardrail** | **Mastra** processors via `defineAgent({ inputProcessors })` |
| Add a **domain capability** (tools + context + permissions) | **Arivie** plugin (`definePlugin`) |
| Take a **webhook → run an agent** durably (dedupe/retry) | **Arivie** channel + dispatch |
| **Multi-step / human-in-the-loop / scheduled** workflow | **Mastra** workflows *(backlogged — ADR 0001)* |
| Conversation **memory** | **Mastra** Memory (Arivie wires session = thread) |

## Standing rules (the corrective for the build-vs-reuse trap)

1. **Before building a runtime/agent/chat primitive, check Mastra first.** Hand-rolling a leaf is a bug, not a feature (this session reinvented `useChat` and nearly reinvented durable execution before catching it).
2. **Don't multiply front-doors. Label the ones that must coexist.** `app.prompt` (durable) vs `agent.generate` (ephemeral); `/sessions` (durable protocol) vs `/api/chat` (useChat). Each must say in one line *when* to use it.
3. **New surface area pays rent.** A new concept must earn its place against the cognitive-load tax (the concept count is already high).
