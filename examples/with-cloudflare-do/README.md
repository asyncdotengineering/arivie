# Arivie + Cloudflare Durable Objects example

Cloudflare Worker + Durable Object — Arivie runs inside the DO; the worker routes `POST /api/arivie` to a named stub.

`arivie.config.ts` reads model keys from the Worker's `env` bindings (not `process.env`). See `getArivieRuntime(env)`.

## Seed the database

Provision Postgres in your Cloudflare-reachable region (Hyperdrive, Neon, Supabase, or your own). Then seed it with the same dogfood schema the other examples use:

```bash
psql "$DATABASE_URL" -f seed.sql
```

The schema is shared with `with-nextjs/seed.sql` — 5 entities, 46 rows.

## Semantic layer (inlined at build time)

Cloudflare Workers (even with `nodejs_compat`) do not expose the example's `semantic/` YAML files at runtime. The `prebuild` / `predev` hook runs `scripts/inline-semantic.ts`, which parses the YAML on the build host and emits `src/semantic-inline.ts`. The runtime imports the pre-built `SemanticLayer` as a plain ES module — no filesystem access at request time.

Re-run by hand after editing `semantic/`:

```bash
pnpm --filter with-cloudflare-do exec tsx scripts/inline-semantic.ts
```

## Deploy

```bash
wrangler login
wrangler secret put DATABASE_URL
pnpm --filter with-cloudflare-do build   # wrangler deploy --dry-run
wrangler deploy
```

## Local dev

```bash
wrangler dev
```

CI validates `pnpm --filter with-cloudflare-do build` only (dry-run deploy, no boot:smoke).
