# Build an Agent — Northwind Analytics

The finished agent from the **[Build an Agent](https://arivie-docs.vercel.app/tutorial/first-agent/)** tutorial: an analytics agent over a tiny storefront (customers + orders), exposed as an **HTTP API** — no web UI.

The tutorial constructs this from an empty config over nine steps. This directory is the end state, so you can run it directly or check your work against it.

## Run it

```bash
pnpm install
pnpm --filter build-an-agent db:create   # or: createdb arivie_tutorial
pnpm --filter build-an-agent db:setup    # schema + arivie_reader role + seed
# put OPENAI_API_KEY + DATABASE_URL in .env (auto-loaded), then either:
pnpm exec arivie chat --config examples/build-an-agent/arivie.config.ts   # terminal
pnpm --filter build-an-agent serve                                        # HTTP API on :3000
```

Ask: *"What was revenue last week?"* · *"Average order value this month?"* · *"Revenue by plan tier?"*

## What's here (maps to the tutorial steps)

| File | Tutorial step |
|---|---|
| `arivie.config.ts` | 1 Your First Agent · 4 Connect a Warehouse · 8 Guard the Spend (`arivie_reader`) |
| `db/schema.sql` + `db/seed.ts` | 3 Query Sample Data |
| `semantic/entities/*.yml` | 6 Remember Definitions |
| `skills/weekly-revenue-recap/` | 7 Team Playbooks |
| `server.ts` | 9 Ship It (the HTTP API) |

The same shape builds **any** agent — swap the analytics plugin for your own `definePlugin`. Analytics is the flavor, not the framework.
