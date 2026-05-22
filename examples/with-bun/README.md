# Arivie + Bun example

Bun.serve handler — minimal runtime without Node or Next.js. **Bun ^1.1 required.**

Shows `defineArivie` + `arivie.next.POST` at `POST /api/arivie`.

## Environment

```bash
cp .env.example .env
```

## Seed

```bash
psql "$DATABASE_URL" -f seed.sql
```

## Run

```bash
bun run dev
```

Mock mode (no API keys): streamed body includes `Example mock response`.
