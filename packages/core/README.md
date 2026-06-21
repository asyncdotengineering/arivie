# @arivie/core

Domain-neutral Arivie runtime: `defineArivie(ArivieAppConfig)`, plugin manifests, durable sessions, replayable events, and HTTP session routes.

## Install

```bash
pnpm add @arivie/core @arivie/plugin-analytics @arivie/plugin-postgres ai
```

## Usage

```ts
import { anthropic } from "@ai-sdk/anthropic";
import { defineAgent, defineArivie } from "@arivie/core";
import { analytics } from "@arivie/plugin-analytics";
import { postgresRuntime, postgresSource } from "@arivie/plugin-postgres";

export const arivie = await defineArivie({
  app: { id: "my-saas", name: "My SaaS" },
  model: anthropic("claude-sonnet-4-20250514"),
  storage: postgresRuntime({ url: process.env.DATABASE_URL! }),
  plugins: [
    analytics({
      semanticPath: "./semantic",
      sources: {
        warehouse: postgresSource({
          url: process.env.DATABASE_URL!,
          readOnlyRole: "arivie_reader",
        }),
      },
      compileMetric: true,
    }),
  ],
  agents: {
    analyst: defineAgent({
      instructions: "Answer with concise, auditable analysis.",
      capabilities: ["analytics.query", "analytics.compile_metric"],
    }),
  },
  context: { root: "./semantic" },
  resolveUser: async () => ({
    userId: "u1",
    permissions: ["analytics:read"],
    dbRole: "arivie_reader",
  }),
});
```

Use `arivie.handler(req)` in any Fetch-compatible runtime, or mount `arivie.hono` in a Hono app. Programmatic callers can create runs through `arivie.sessions.create(...)` and read structured events from the returned stream.

## Shutdown

Call `dispose()` on the app returned by `defineArivie` when shutting down the process.

## License

Apache-2.0
