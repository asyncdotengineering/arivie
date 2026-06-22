---
"@arivie/core": minor
"@arivie/context": minor
"@arivie/agent": minor
"@arivie/cli": minor
"@arivie/db-postgres": minor
"@arivie/embeddings": minor
"@arivie/github": minor
"@arivie/mcp": minor
"@arivie/plugin-analytics": minor
"@arivie/plugin-github": minor
"@arivie/plugin-postgres": minor
"@arivie/react": minor
"@arivie/semantic": minor
"@arivie/source-mcp": minor
"@arivie/source-mixpanel": minor
"@arivie/ui-catalog": minor
"@arivie/workspace": minor
---

Arivie v2.1.0 — context layer + Mastra embrace.

Additive features on `@arivie/core`:
- `app.prompt()` — durable one-shot run primitive.
- `POST /api/chat` — native Vercel AI SDK `useChat` server via `@mastra/ai-sdk`.
- Agent guardrails — `defineAgent({ inputProcessors / outputProcessors })` over Mastra processors.
- **Context layer wired** — `config.context` now loads `@arivie/context`; `usage_mode: always` knowledge injects into instructions, and `usage_mode: auto` pages are retrievable via a pluggable `ContextRetriever` port + the `mastraRagRetriever` default adapter (Mastra `@mastra/rag` over any `MastraVector`).
- `@arivie/core/mastra` — expose Mastra primitives (un-shadow).

`@arivie/context`: knowledge pages now load schema-free (drop a wiki `.md`).
