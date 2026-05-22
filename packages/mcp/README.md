# @arivie/mcp

Mastra `MCPServer` wiring for Arivie — exposes `ask`, `query`, `schema`, and `memory` MCP tools plus the live agent as `ask_arivie` (REQ-26). Built on `@mastra/mcp` primitives; no hand-rolled JSON-RPC.

Public surface contract: [RFC-002 §4.7](../../../.research/07-rfc/RFC-002-concrete-tech-implementation/02-requirements-interfaces.md#47-anaclipmcp--mastra-mcp-server-wiring).

```ts
import { makeMcpServer } from "@arivie/mcp";

const mcp = makeMcpServer({
  agent,
  semantic,
  db,
  ownerId: "acme",
  ownerName: "Acme Corp",
});

await mcp.startStdio();
```

## Next.js App Router (`@arivie/mcp/next`)

```ts
// app/api/arivie/mcp/route.ts
import { makeMcpServer } from "@arivie/mcp";
import { makeMcpRouteHandler } from "@arivie/mcp/next";

const mcp = makeMcpServer({ agent, semantic, db, ownerId, ownerName });

export const POST = makeMcpRouteHandler(mcp);
```

Uses Mastra `startHTTP` in serverless mode (stateless per request).

## Stdio transport (`@arivie/mcp/stdio`)

```ts
import { makeMcpServer } from "@arivie/mcp";
import { startStdioServer } from "@arivie/mcp/stdio";

const mcp = makeMcpServer({ agent, semantic, db, ownerId, ownerName });

await startStdioServer({ mcp });
```
