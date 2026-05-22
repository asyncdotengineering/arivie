# Arivie + Clerk example

Next.js + Clerk — `ownerId` comes from `auth().userId`; Clerk middleware protects routes.

## Auth bypass (test / CI only)

When `ARIVIE_AUTH_BYPASS=1`, send `Authorization: Bearer arivie-bypass-token` and the route uses `ownerId = bypass-user`. Refused when `NODE_ENV=production` unless `ARIVIE_AUTH_BYPASS_FORCE=1`.

## Environment

```bash
cp .env.example .env.local
```

## Seed & run

```bash
psql "$DATABASE_URL" -f seed.sql
pnpm --filter with-clerk dev
```

Mock mode first line: `Example mock response (set GOOGLE_GENERATIVE_AI_API_KEY for a live Gemini run).`
