# @arivie/core

Arivie core: the `defineArivie` factory, public configuration types, owner-identity boundary, and runtime adapters for Next.js, Hono, Bun, and Cloudflare Workers. Built on Mastra; single-tenant per instance.

## Install

```bash
pnpm add @arivie/core @arivie/db-postgres @arivie/semantic @arivie/workspace \
         @mastra/core @mastra/mcp @mastra/memory @mastra/pg ai
```

## Usage

```ts
// arivie.config.ts
import { defineArivie } from '@arivie/core';
import { postgresAdapter } from '@arivie/db-postgres';
import { anthropic } from '@ai-sdk/anthropic';

export const arivie = await defineArivie({
  owner: { id: process.env.ARIVIE_OWNER_ID!, name: 'My SaaS' },
  model: anthropic('claude-opus-4-7'),
  sources: {
    postgres: postgresAdapter({
      url: process.env.DATABASE_URL!,
      readOnlyRole: 'arivie_reader',
    }),
  },
  semantic: {
    path: './semantic',
    mode: 'preload', // or 'indexed' (requires embeddings) or 'auto'
  },
  workspace: { rootDir: './semantic' },
  resolveUser: async (req) => {
    return { userId: 'u1', permissions: ['analytics:read'], dbRole: 'arivie_reader' };
  },
});
```

### Runtime adapters

Pick the sub-path that matches your server.

```ts
// app/api/arivie/route.ts (Next.js App Router)
export { POST } from '@arivie/core/next';
```

```ts
// hono server
import { Hono } from 'hono';
import { honoMiddleware } from '@arivie/core/hono';
import { arivie } from './arivie.config';

const app = new Hono();
app.post('/api/arivie', honoMiddleware(arivie));
```

```ts
// Bun server
import { bunHandler } from '@arivie/core/bun';
import { arivie } from './arivie.config';

export default bunHandler(arivie);
```

```ts
// Cloudflare Workers / Durable Objects
import { workerHandler } from '@arivie/core/worker';
import { arivie } from './arivie.config';

export default workerHandler(arivie);
```

## Shutdown

Call `dispose()` on the instance returned by `defineArivie` when shutting down the process. This closes Postgres pools and disconnects MCP stdio child processes for sources that implement `SourceAdapter.close`.

## Status

v0.2 — Sprint 0 (Foundation). Ships `defineArivie` with `sources`, `workspace`, and semantic `preload` / `indexed` / `auto` modes. Agent tools are `execute_<sourceName>` per configured source (plus optional `compile_metric`).

The public surface contract is documented in RFC-003 v2.

## License

Apache-2.0
