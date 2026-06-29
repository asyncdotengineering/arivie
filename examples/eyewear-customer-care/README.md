# Eyewear Customer Care (draft-assist)

An Arivie 3.0.0 example for **Lens & Luxe**, a prescription-eyewear DTC brand. A read-only `care` agent looks up orders, prescriptions, refunds, and remakes via SQL, then **drafts** reply suggestions for human support agents.

**Draft-assist only** — the agent never sends messages, never opens email channels, and never initiates refunds or remakes in ops systems.

## What's included

| Piece | Purpose |
|---|---|
| `semantic/` | Eyewear entities — orders, customers, order_items (Rx), refunds, remakes |
| `knowledge/` | Customer-care playbooks + policy references (return, refund, remake, warranty, store voice) |
| `db/seed.sql` | PGlite/local Postgres fixture (~3 customers, 5 orders, one refund, one remake) |
| `arivie.config.ts` | `care` agent with `analytics.query` only, `arivie_reader` role |
| `scripts/smoke.ts` | End-to-end smoke: PGlite seed → care agent → printed draft |

### Knowledge pack

- **handle-customer-query** — SOP: identify order → SQL facts → pick policy → draft in store voice
- **return-policy**, **refund-window**, **prescription-remake**, **warranty** — governing playbooks
- **definitions**, **store-voice** — reference docs for terms and reply tone

## Setup

```bash
# From repo root
pnpm install

# Optional: seed local Postgres instead of PGlite (smoke uses PGlite in-process)
createdb arivie_eyewear
DATABASE_URL=postgresql://localhost:5432/arivie_eyewear \
  pnpm --filter @arivie/example-eyewear-customer-care db:seed
```

`OPENAI_API_KEY` is required to run a live draft. Without it the smoke script prints a notice and exits 0 (it does not draft) — a draft-assist agent needs a real model to compose grounded replies.

## Run

```bash
# Typecheck
pnpm --filter @arivie/example-eyewear-customer-care typecheck

# Smoke test (PGlite + seed.sql, no Docker)
pnpm --filter @arivie/example-eyewear-customer-care smoke

# Interactive chat (requires DATABASE_URL + OPENAI_API_KEY or mock)
pnpm exec arivie chat --config examples/eyewear-customer-care/arivie.config.ts --agent care
```

## Fixture note

`jane@example.com` has order **#1003** (`refunded`, cash refund `$174.16` on 2026-06-12). `john@example.com` has order **#1002** with an open **wrong_prescription** remake. The smoke prompt uses Jane's refund inquiry.

## Out of scope

- Email or any outbound channel integration
- Autonomous send — all output is a draft for human review
- Refund/remake/warranty initiation in backend systems
- Medical or optometric advice on prescriptions