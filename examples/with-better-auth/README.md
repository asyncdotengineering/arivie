# Arivie + Better Auth example

Next.js + Better Auth (email/password) — `ownerId` from `session.user.id` or email.

Auth routes: `app/api/auth/[...all]/route.ts`.

## Auth bypass

`ARIVIE_AUTH_BYPASS=1` + bearer `arivie-bypass-token` for CI smoke. Production guard documented in `lib/auth-bypass.ts`.

## Run

```bash
cp .env.example .env.local
psql "$DATABASE_URL" -f seed.sql
pnpm --filter with-better-auth dev
```
