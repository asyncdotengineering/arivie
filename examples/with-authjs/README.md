# Arivie + Auth.js (next-auth v4) example

Next.js App Router for the chat UI + **Pages Router** for Auth.js v4 at `pages/api/auth/[...nextauth].ts` (v5 App Router auth is still beta on 2026-05-20).

`ownerId` from `getServerSession` → `session.user.email`.

## Auth bypass

`ARIVIE_AUTH_BYPASS=1` authorizes a deterministic credentials user for CI.

**Safety guard:** the bypass refuses to engage when `NODE_ENV=production` unless `ARIVIE_AUTH_BYPASS_FORCE=1` is also set. The Next.js process exits with code 1 at startup rather than serving requests under a forged session.

## Run

```bash
cp .env.example .env.local
psql "$DATABASE_URL" -f seed.sql
pnpm --filter with-authjs dev
```
