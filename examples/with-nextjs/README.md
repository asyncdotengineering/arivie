# Arivie + Next.js example

Minimal App Router app showing:

- `defineArivie` + `arivie.next` at `app/api/arivie/route.ts`
- MCP HTTP adapter at `app/api/arivie/mcp/route.ts`
- Registry `AgentChat` (`useAgent` under the hood) on the home page

## Quick start

```bash
cd arivie
pnpm install
cp examples/with-nextjs/.env.example examples/with-nextjs/.env
# Edit DATABASE_URL (and optionally ANTHROPIC_API_KEY)

pnpm --filter with-nextjs build
pnpm --filter with-nextjs dev
```

Run `arivie setup` from a project with `arivie.config.ts` pointed at the same database before chatting.

Without `ANTHROPIC_API_KEY`, the example uses a deterministic mock model for smoke tests.
