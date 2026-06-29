# Eyewear Customer Care (draft-assist)

An Arivie 3.0.0 example for a prescription-eyewear DTC brand: a **read-only** customer-care agent that looks up orders, prescriptions, refunds, and remake requests, then **drafts** reply suggestions for human agents. It never sends messages or initiates refunds or remakes.

## What's included (K1)

| Piece | Purpose |
|---|---|
| `semantic/` | Eyewear entities — orders, customers, order_items (Rx), refunds, remakes |
| `db/seed.sql` | PGlite/local Postgres fixture (~3 customers, 5 orders, one refund, one remake) |
| `arivie.config.ts` | `care` agent with `analytics.query` only, `arivie_reader` role |

Knowledge playbooks (`knowledge/`) and draft-assist wiring land in later chunks.

## Setup

```bash
# From repo root — install workspace deps if needed
pnpm install

# Seed local Postgres (create DB first if needed)
createdb arivie_eyewear  # optional
DATABASE_URL=postgresql://localhost:5432/arivie_eyewear \
  pnpm --filter @arivie/example-eyewear-customer-care db:seed
```

Set `OPENAI_API_KEY` and `DATABASE_URL` in `examples/eyewear-customer-care/.env.local` (or export them) before running the agent.

## Run

```bash
# Typecheck
pnpm --filter @arivie/example-eyewear-customer-care typecheck

# Chat (after K3 agent wiring)
pnpm exec arivie chat --config examples/eyewear-customer-care/arivie.config.ts --agent care
```

## Fixture note

`jane@example.com` has order **#1003** (`refunded`, cash refund on 2026-06-12). `john@example.com` has order **#1002** with an open **wrong_prescription** remake. These rows are the golden-test fixture for order lookup (K4).