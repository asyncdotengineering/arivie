# @arivie/mcp

Mastra `MCPServer` wiring for Arivie — exposes `ask`, `query`, `schema`, and `memory` MCP tools plus the live agent as `ask_arivie` (REQ-26), analytics **prompts**, and semantic-layer **resources**. Built on `@mastra/mcp` primitives; no hand-rolled JSON-RPC.

Public surface contract: [RFC-002 §4.7](../../../.research/07-rfc/RFC-002-concrete-tech-implementation/02-requirements-interfaces.md#47-anaclipmcp--mastra-mcp-server-wiring).

## Zero-config server (`npx`)

Run a stdio MCP server with no configuration — for MCP clients (Claude Desktop, Cursor, ChatGPT) or registry validation:

```bash
npx -y @arivie/mcp
```

Tools, prompts, and resources are listable immediately. Optional env upgrades it in place: `DATABASE_URL` enables `query` against a real database, `ARIVIE_SEMANTIC_PATH` loads your semantic layer for `schema` + resources, `ARIVIE_OWNER_NAME` labels the server. Without them, `schema`/resources serve a built-in sample and `query`/`ask` return an actionable "configure X" message when invoked.

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
