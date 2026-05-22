# Arivie + Hono example

Hono on Node — for stateless HTTP serving outside Next.js.

Minimal Hono app showing `defineArivie` + `arivie.next.POST` at `POST /api/arivie`.

## Environment

```bash
cp .env.example .env
# DATABASE_URL — Postgres with seed.sql applied
# GOOGLE_GENERATIVE_AI_API_KEY | ANTHROPIC_API_KEY | OPENAI_API_KEY (optional)
```

## Seed

```bash
psql "$DATABASE_URL" -f seed.sql
pnpm dlx arivie setup   # from a project with matching ARIVIE_OWNER_ID
```

Or run `boot:smoke`, which seeds and calls `setupRole` automatically.

## Run

```bash
pnpm --filter with-hono dev
curl -X POST http://localhost:3000/api/arivie \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"How many customers?"}'
```

Without model keys, the first streamed line contains:

`Example mock response (set GOOGLE_GENERATIVE_AI_API_KEY for a live Gemini run).`
