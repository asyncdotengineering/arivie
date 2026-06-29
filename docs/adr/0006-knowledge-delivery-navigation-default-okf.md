# ADR 0006 — Knowledge delivery: navigation-by-default + a cached governance core; the knowledge layer goes OKF-shaped

**Status:** Accepted (supersedes the preload default in `@arivie/plugin-analytics`)
**Date:** 2026-06-29
**Driver:** A grounded research pass on context management + prompt caching for data agents — Anthropic's prompt-caching mechanics (authoritative), a code review of the YC competitor **ktx** (Kaelio/ktx), Google's **Open Knowledge Format (OKF v0.1)** spec + blogs, and ~12 practitioner videos on context/loop engineering. Three independent sources converged on one architecture, so the direction is over-determined.

## The decision

Two changes, shipped as one coherent move:

1. **Knowledge delivery is navigation-by-default, with a small cached governance core** — replacing the current "preload the entire semantic layer into the system prompt every request" default in `@arivie/plugin-analytics`.

2. **The two layers are made sharply distinct, and the knowledge layer takes the OKF shape:**
   - The **executable semantic layer** (`@arivie/semantic` — entities/measures/dimensions/joins/segments) **stays typed and SQL-shaped.** It is the moat (governed, compilable SQL). It does **not** become free-form.
   - The **knowledge layer** (`@arivie/context`) becomes a **navigable, cross-linked graph of typed markdown concepts** (OKF shape) — playbooks, references, glossary terms, prose — fronted by an `index.md` catalog, with detail fetched on demand.

## Why (the research, compressed)

### The tension everyone misses: retrieval and prompt caching pull against each other

Prompt caching is a **strict prefix match** (render order `tools → system → messages`; any byte change in the prefix invalidates everything after it; cache **reads cost ~0.1×**, writes 1.25×/2×). This means a fully-preloaded semantic layer in the system prompt is *cache-friendly* — but it pays the full layer on the uncached path, **dilutes the effective context window** (~128k–200k effective, not the nominal 1M), adds attention latency, and **does not scale** past a few dozen entities. Caching saves money; it does not save accuracy from context rot. The two forces are reconciled by **tiering**, not by choosing one.

### Three independent sources converged on the same shape

- **Anthropic** (caching mechanics + tool-search/skills "append, don't swap"): keep a stable cached prefix; load detail on demand as tool results *after* the breakpoint.
- **ktx** (Kaelio/ktx, YC P25): ships **navigation-only** as its production default — `discover_data` (index/refs) → `read` (detail) → `query` (execute), hybrid BM25+vector+token retrieval fused with RRF, minimal tool-output projection with safety-signal hoisting. It is **live proof Arivie's built-but-disabled "indexed mode" works.** It has *no* always-inject path.
- **OKF** (Google, v0.1) + practitioners: a knowledge layer is **not SQL** — the spec requires essentially one field (`type`); a concept can be a table, a metric, a **playbook**, a **reference**, prose, an ontology entity. Retrieval is `index.md` → route to one concept → reason narrowly (explicitly *not* RAG-everything, *not* dump-everything). `index.md` = the cached catalog tier; concepts = the navigated detail.

### The distinction that protects the moat

Practitioner guidance ("generalize everything into typed concepts") is right for the **knowledge** layer and **wrong** for the **executable** layer. A measure must stay a typed SQL expression *because* its guarantee is that it compiles to correct, governed SQL — the SQL-safety differentiator ktx/OKF/generic agents do not provide. Free-prose semantics ⇒ hallucinated SQL. So: the executable layer stays narrow and typed (one `type` among many if we ever emit OKF); "anything" lives in the knowledge layer beside it, cross-linked.

## The end-state architecture

Prompt assembled in volatility order, with the cache breakpoint placed deliberately:

```
[ cached prefix — byte-stable all session, served at ~0.1× ]
 1. Tools (sorted, deterministic): discover/search · read_entity · compile_metric/execute
 2. Discipline rules (reasoning, JOIN, grounding, PII, hard constraints) — frozen
 3. Governance core: entity catalog/index (names + 1-line desc + keywords),
    join-graph skeleton, FULL glossary          ← CACHE BREAKPOINT HERE
─────────────────────────────────────────────────────────────────
[ behind the breakpoint — never invalidates the cache above ]
 4. Retrieved detail for THIS question (entity measures/dims/joins/hints/sample SQL;
    knowledge concepts: playbooks/references) — arrives as TOOL RESULTS, in messages
 5. Conversation + user question
```

On-disk shape:

```
semantic/                     ← executable, typed, SQL-shaped (THE MOAT — unchanged)
  entities/*.yml              measures · dimensions · joins · segments
knowledge/                    ← OKF-shaped: "anything" goes here
  index.md                    ← the cached catalog tier (governance core)
  concepts/return-policy.md   type: playbook
  concepts/refund-window.md   type: reference
  glossary/net-revenue.md     type: term  →  links to semantic/orders.yml#net_revenue
```

Retrieval: hybrid (BM25 + vector + token-overlap fallback, RRF fusion), relevance-gated (skip the fetch for trivial single-entity/aggregate questions), tool outputs minimally projected but **hoisting** correctness signals (fan-out / compile-only) into `notes`.

## Breaking changes (embraced — alpha, → major bump 3.0.0)

One default, no mode matrix (a `preload | auto | indexed` flag would be the capability-sprawl this ADR exists to avoid). Delete, don't accrete:

- Remove `mode: "auto" | "preload"` from `AnalyticsPluginConfig`; remove `resolveContextMode` / `autoDetectMode`.
- Remove the `"indexed mode not supported in plugin-analytics v1"` throw — indexed/navigation becomes the only path.
- Retire the full-layer `semanticLayerSection` preload as the default; `buildSystemPromptIndexed` + the catalog/glossary core becomes the system prompt.
- Narrow `usage_mode: always` to mean "the cached governance core" (catalog + glossary); everything else is navigated.
- Delete the phantom `@arivie/deploy` filter in the root build script and the frozen deploy-stub test (cf. ADR 0004 audit residue).

## Build-for-one discipline — build now vs defer

**Build now** (the eyewear customer-care use case needs exactly these): `type` discriminator + markdown concepts in the knowledge layer; **`playbook` and `reference` types** (where the store's policy nuance lives); the `index.md` cached catalog; cross-links from glossary/playbook concepts → semantic entities.

**Defer** (no caller yet — premature scaling): a general typed-relationship ontology engine; freshness/drift-sync automation; `log.md` tooling; Entity-Map emission; OKF producers/consumers/visualizers. Shape toward OKF compatibility (cheap, reversible); do **not** rebuild the product around the OKF brand while it is v0.1.

## Verification gate (the loop)

Ship the default flip **only if** golden-SQL eval accuracy on the flagship `with-pos-fnb` example (17 entities) is **≥ the preload baseline**, while per-request tokens drop and the layer scales past today's ~8k-token preload ceiling. This forces `arivie eval` to graduate from dogfood-only to a real accuracy gate — pulling the "Measure" gap from ADR 0004 onto the critical path instead of crowding it out.

## What this beats ktx on

Arivie keeps a deliberate **cached governance core** (discipline + glossary + catalog always present) — ktx has *no* always-inject path and bets "retrieve everything, trust the search." For a *governed* agent, the rules and glossary that prevent wrong answers must never be a retrieval miss. Plus: single-language TS (ktx runs a Node CLI + a Python daemon). Governance-in-cache + single-language DX is the differentiated wedge.

## References

- ADR 0002 (Arivie vs Mastra ownership — adopt standards, don't rebuild leaves), ADR 0003 (context layer + skills), ADR 0004 (product angle + the audit naming Measure/Ship as the gaps).
- Anthropic prompt-caching reference (prefix match, breakpoints, TTL, minimum cacheable tokens).
- ktx (Kaelio/ktx): `packages/cli/src/context/mcp/context-tools.ts`, `context/search/{rrf,hybrid-search-core}.ts`, `llm/{model-provider,message-builder}.ts`.
- Open Knowledge Format v0.1: `GoogleCloudPlatform/knowledge-catalog/okf/SPEC.md`; Google Cloud blog "How the Open Knowledge Format can improve data sharing".
