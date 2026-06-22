# Aurora Support — a context-layer agent (no analytics, no database)

A production-shaped customer-support agent built **entirely on Arivie's context layer**. No SQL, no semantic layer, no warehouse — just an agent and a governed knowledge base. It shows the other half of Arivie: declarative knowledge, not analytics.

Two kinds of knowledge, the skills↔context split made concrete:
- **`usage_mode: always`** — `context/policy.md` (refunds, escalation, tone) is injected into the agent's instructions **every turn**. Core truth it must never get wrong.
- **`usage_mode: auto`** — the FAQ pages (`faq-*.md`) are embedded and **retrieved on demand** via Mastra RAG (`search_context`). The agent pulls the right article only when a question needs it.

Zero infra: the durable runtime runs in memory, conversation memory in the default LibSQL file, and the knowledge index in a local LibSQL vector store. Nothing to provision.

## Run it

```bash
pnpm install
# put OPENAI_API_KEY in .env (auto-loaded); then:
pnpm exec arivie chat --config examples/support-agent/arivie.config.ts
```

Try:
- *"How do I reset my password?"* → the agent calls `search_context`, pulls the FAQ, and quotes the steps.
- *"What's your refund policy?"* → answered from the always-injected policy, no retrieval needed.
- *"Does Aurora integrate with SAP and what does it cost?"* → not in the knowledge base, so it offers to escalate instead of inventing an answer.

## How it's wired

```ts
context: {
  root: "./context",
  retriever: mastraRagRetriever({ embedding: "openai/text-embedding-3-small" }),
}
```

`always` pages inject; `auto` pages flow through `mastraRagRetriever` (Mastra `@mastra/rag` → any `MastraVector`; defaults to a local LibSQL file). Swap `vector:` for `PgVector`/Pinecone/etc., or pass your own `ContextRetriever` to plug in a different RAG pipeline entirely. See the [Knowledge Agent guide](https://arivie-docs.vercel.app/guide/knowledge-agent/).

## What this validates

This example is the live end-to-end test of the context layer: always-inject shapes behavior (the agent escalates instead of hallucinating), and auto-retrieval is actually invoked and grounds the answer. The same shape builds any knowledge agent — support, onboarding, internal docs, a policy assistant.
