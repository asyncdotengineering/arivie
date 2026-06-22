# ADR 0005 — Reference deployment: a governed analytics agent in production (Lens & Luxe)

**Status:** Accepted (reference architecture)
**Date:** 2026-06-22
**Driver:** The first real client deployment on the published `@arivie/*` 2.2.0 packages — a DTC prescription-eyewear brand (Lens & Luxe, WooCommerce on Supabase Postgres). This ADR records how it works end to end, the decisions that made it trustworthy, and the gaps it exposed, so the next analytics agent ships the same way.

## What it is

An "ask your store" agent: the owner types a plain-English question, gets a number **backed by the exact SQL**, **read-only**, over the live production database. Built as `defineArivie` + the analytics plugin + a hand-authored semantic layer + a minimalist Next.js chat UI, deployed to Vercel.

```
Owner ──▶ Next.js UI (minimalist chat) ──▶ POST /api/ask
                                              │  arivie.prompt({ agent, prompt, user })
                                              ▼
                              Arivie analytics agent (gpt-4o)
                                ├─ semantic layer (entities + glossary + measures)
                                ├─ compile_metric / execute_postgres  (SELECT-only guard)
                                └─ postgresSource(arivie_reader)  ──▶  Supabase Postgres (READ ONLY)
```

## Decision 1 — Read-only by construction (three layers)

Production data is sacred. Access is read-only at three independent layers, so no single failure can write:

1. **A dedicated `arivie_reader` Postgres role** — `LOGIN`, `SELECT` only, nothing else. The app connects *as this role*. Verified: `INSERT → permission denied`. (The only DDL run on production was creating this role + its grants — no data touched.)
2. **Arivie's SELECT-only SQL guard** (`validateExecuteSql`) — rejects any non-`SELECT` before it reaches the DB.
3. **No write path** — runtime sessions use `InMemoryRuntimeStorage`; the production DB is only ever read.

> Standing rule: never point an agent at production with the app's normal (writable) DB user. Mint a `SELECT`-only role and connect as it. Least privilege beats trusting the guard.

## Decision 2 — The semantic layer is aligned to the brand's source of truth, to the dollar

The agent's value is the owner *trusting the number* — which means it must equal their existing dashboard. We read the brand's own analytics service (`/api/analytics`) and matched its methodology exactly:

- **Included statuses:** everything except `pending/cancelled/failed` (WooCommerce logic) — not "completed only".
- **Net basis:** `total − tax − shipping` (raw `total` overcounts by ~19%).
- **Returns:** subtracted from a `_ll_refunds` JSONB order-meta, bucketed by *refund date* — not by order status.
- **Timezone:** all bucketing in `America/Chicago` (`AT TIME ZONE 'UTC' AT TIME ZONE 'America/Chicago'`).

Net revenue = (total − tax − shipping, included statuses) − returns. Verified: the agent reproduces **$175,652.04** for 2025 — matching the dashboard API to the cent. The cross-table returns subtraction can't be a single measure, so it's encoded as a **canonical `example_query` + a precise hint** the agent reuses.

> Standing rule: don't define measures from first principles — read the customer's existing analytics code/API and mirror its exact math (status sets, net/gross basis, timezone, refund sourcing). "Close" loses trust; "matches your dashboard" wins it.

## Decision 3 — `/api/ask` (prompt path), not the built-in `/api/chat`

The built-in `POST /api/chat` (`handleChatStream`, Mastra-agent stream) does **not** wire the analytics SQL tools — the agent replies "I can't access the data" (a silent failure: HTTP 200, valid stream, wrong behavior). The tools live in the durable-runtime path that `arivie.prompt()` / `arivie chat` use. So the UI calls a custom `POST /api/ask` route → `arivie.prompt({ agent, prompt, user })`, which has the tools and answers correctly.

Trade-off: loses token streaming (the answer arrives whole, behind a "querying…" state). Acceptable for an owner Q&A tool. **This is a framework gap, tracked separately** — `/api/chat` should carry the analytics tools so a useChat UI works out of the box.

## Decision 4 — Serverless deployment (Vercel) needs two adjustments

`defineArivie` assumes a writable filesystem and co-located data files; Vercel's serverless runtime has neither. Two fixes made it run:

1. **In-memory conversation memory** — `memory: new InMemoryStore()`. The default LibSQL store tries to `mkdir .arivie/` on the read-only FS and crashes the function.
2. **Bundle the semantic files** — `outputFileTracingIncludes: { "/api/ask": ["./semantic/**/*"] }` in `next.config`, plus resolving `semanticPath` from `process.cwd()`. Otherwise the `semantic/*.yml` files aren't in the function bundle and the agent runs with an empty layer.

The session-mode pooler (`:5432`) connected fine from serverless at owner-tool traffic. Env (`OPENAI_API_KEY`, `OPENAI_MODEL`, `ANALYST_DATABASE_URL`) set encrypted in Vercel Production.

> Standing rule: deploy success ≠ working. The function 500'd on the first deploy; only a live `curl`/browser check surfaced the read-only-FS and bundling failures. Always verify the deployed endpoint, not just the build.

## Decision 5 — Access protection is a deliberate choice, not a default

Vercel's default team-SSO gate (401) blocks the owner. Opening it makes the brand's financials world-readable (read-only, but public). This is a data-exposure decision the customer must own — options: team-only, password protection, or real auth. Never leave a client's revenue data public without an explicit decision.

## Consequences

- **+** A trustworthy, owner-ready analytics agent: plain-English in, dashboard-exact numbers out, with the SQL shown, read-only.
- **+** A repeatable recipe: `SELECT`-only role → mirror the customer's analytics math → `arivie.prompt` route → serverless preset → verify live → decide access.
- **−** Framework gaps surfaced (tracked): `/api/chat` lacks analytics tools; no serverless preset (memory + data-file bundling). A `@arivie/deploy` / serverless config would remove the manual fixes (ADR 0004 priority).

## References

- ADR 0003 (context/glossary — the `status: ambiguous` "revenue" clarification used here), ADR 0004 (product angle — build-tool for data agents), ADR 0002 (Arivie vs Mastra ownership).
- Framework issue: `/api/chat` (handleChatStream) doesn't wire analytics SQL tools.
