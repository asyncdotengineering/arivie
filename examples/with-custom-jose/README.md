# Arivie + custom JWT (jose) example

Next.js + hand-rolled JWT verification — escape hatch for custom issuers (Okta, Auth0 with custom claims, internal IdPs).

Send `Authorization: Bearer <jwt>`; `ownerId` = verified `sub` (HS256 via `JWT_SECRET`).

## Auth bypass

`ARIVIE_AUTH_BYPASS=1` + `Bearer arivie-bypass-token` for CI.

## Run

```bash
cp .env.example .env.local
psql "$DATABASE_URL" -f seed.sql
pnpm --filter with-custom-jose dev
```
