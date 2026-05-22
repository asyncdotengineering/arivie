# Arivie + WorkOS AuthKit example

Next.js + WorkOS AuthKit — `ownerId` from `withAuth()` session user id.

## Auth bypass (CI / test)

`ARIVIE_AUTH_BYPASS=1` + `Authorization: Bearer arivie-bypass-token` → `ownerId = bypass-user`. Blocked in production unless `ARIVIE_AUTH_BYPASS_FORCE=1`.

## Run

```bash
cp .env.example .env.local
psql "$DATABASE_URL" -f seed.sql
pnpm --filter with-workos dev
```

Mock stream contains: `Example mock response`.
