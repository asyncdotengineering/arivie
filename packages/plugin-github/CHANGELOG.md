# @arivie/plugin-github

## 3.0.0

### Major Changes

- 3586aba: Arivie v3.0.0 — navigation-by-default knowledge delivery + OKF-shaped context layer.

  BREAKING (see [ADR 0006](./docs/adr/0006-knowledge-delivery-navigation-default-okf.md)):

  - **`@arivie/plugin-analytics`**: remove `mode` config (`"preload"` / `"auto"`). Navigation-by-default replaces preload — a cached governance core (entity catalog, join skeleton, glossary) sits behind the prompt-cache breakpoint; entity detail and knowledge concepts are fetched on demand via tools.
  - **`@arivie/context`**: OKF-shaped knowledge layer — markdown concepts carry `type: playbook | reference | term`, fronted by `index.md` catalog and `semantic:` cross-links to the executable semantic layer.
  - **`@arivie/agent`** / **`@arivie/core`**: system-prompt assembly and plugin config surface updated for the single navigation path.

  All `@arivie/*` packages move to 3.0.0 together (lockstep), consistent with prior releases.

### Patch Changes

- Updated dependencies [3586aba]
  - @arivie/core@3.0.0
  - @arivie/github@3.0.0

## 3.0.0

### Major Changes

- 0ac4a88: Arivie v2.0.0 — general-agent-framework release.

  `@arivie/core` is now a domain-neutral agent framework: a plugin SDK
  (`definePlugin`), runtime storage + dispatch, an event/session/run surface, a
  Hono HTTP server, and `defineArivie` as the app builder. Analytics is demoted
  to a first-party plugin (`@arivie/plugin-analytics`), alongside
  `@arivie/plugin-postgres` and `@arivie/plugin-github`; context layers move to
  `@arivie/context`.

  Highlights: Mastra Memory wired through the session as the conversation thread;
  durable LibSQL memory by default (history persists + resumes across restarts);
  `arivie chat` terminal client with an Ink TUI (streaming, thread picker/resume)
  and a non-TTY REPL fallback; `arivie info` manifest inspection; `.env` autoload
  for configs; optional DB role for queries (SELECT-only SQL guard always on).

  BREAKING: the analytics-specific `@arivie/core` API is replaced by the plugin
  SDK + `defineArivie`. All packages move to 2.0.0 together.

### Minor Changes

- f419cf7: Arivie v2.1.0 — context layer + Mastra embrace.

  Additive features on `@arivie/core`:

  - `app.prompt()` — durable one-shot run primitive.
  - `POST /api/chat` — native Vercel AI SDK `useChat` server via `@mastra/ai-sdk`.
  - Agent guardrails — `defineAgent({ inputProcessors / outputProcessors })` over Mastra processors.
  - **Context layer wired** — `config.context` now loads `@arivie/context`; `usage_mode: always` knowledge injects into instructions, and `usage_mode: auto` pages are retrievable via a pluggable `ContextRetriever` port + the `mastraRagRetriever` default adapter (Mastra `@mastra/rag` over any `MastraVector`).
  - `@arivie/core/mastra` — expose Mastra primitives (un-shadow).

  `@arivie/context`: knowledge pages now load schema-free (drop a wiki `.md`).

- addb1e0: Arivie v2.2.0 — deeper semantic layer + Mastra-native embeddings.

  Semantic-layer accuracy fields (the moat):

  - **Glossary** with `status: ambiguous` — ambiguous business terms make the agent ASK a clarifying question instead of guessing (authored in `glossary.yml`).
  - **`sample_values`** on dimensions — illustrative real values for high-cardinality columns; grounds WHERE filters.
  - **`metrics.objective`** (maximize | minimize) — correct best/worst/top/bottom ranking.
  - `example_queries` reframed as "canonical query patterns" in the prompt.

  `@arivie/embeddings`: the 3 hard-coded provider factories collapse into one `modelRouterEmbeddings(modelId, { dimensions })` over Mastra's model router (40+ providers). The entity-aware `ParagraphChunker` + `buildIndex`/`retrieve` stay.

- 24ae814: Arivie v2.3.0 — multi-cloud serverless deployment + clarify-once.

  - **Multi-cloud storage defaults** (`@arivie/core`): zero-config memory and the
    default context vector store now degrade across the filesystem reality —
    `./.arivie` (dev) → OS temp dir (Vercel/Lambda/Netlify) → in-memory (no-FS like
    Cloudflare Workers) — instead of crashing with `ENOENT mkdir '.arivie'` on a
    read-only serverless FS. Pass `memory`/`vector` with a hosted store for
    cross-invocation persistence.
  - **Clarify-once** (`@arivie/agent`): the glossary `status: ambiguous` rule now
    EXITS — ask one clarifying question only when the user hasn't indicated which
    sense they mean, then act on their answer. Fixes a production re-clarification
    loop.
  - Docs: a multi-cloud Deployment guide + ADR 0005 (reference deployment).

### Patch Changes

- Updated dependencies [f419cf7]
- Updated dependencies [addb1e0]
- Updated dependencies [24ae814]
- Updated dependencies [0ac4a88]
- Updated dependencies [3586aba]
  - @arivie/core@3.0.0
  - @arivie/github@3.0.0
