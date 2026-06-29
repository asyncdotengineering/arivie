#!/usr/bin/env node
/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Zero-config stdio entry point: `npx -y @arivie/mcp`.
 *
 * Boots an Arivie MCP server over stdio with no required configuration, so MCP
 * clients (and registry validators) can install, connect, and list tools /
 * prompts / resources immediately. Optional env upgrades the server in place:
 *   DATABASE_URL          → enable the `query` tool against a real database
 *   ARIVIE_SEMANTIC_PATH  → load a real semantic layer for `schema` + resources
 *   ARIVIE_OWNER_NAME     → label the server
 * Without them, `schema`/resources use a built-in sample and `query`/`ask`
 * return an actionable "configure X" message when invoked.
 */
import { makeMcpServer } from "./make-server.js";
import { startStdioServer } from "./stdio.js";
import type { McpOptions } from "./types.js";

async function resolveOptions(): Promise<McpOptions> {
  const opts: {
    -readonly [K in keyof McpOptions]?: McpOptions[K];
  } = {
    ownerName: process.env.ARIVIE_OWNER_NAME,
    ownerId: process.env.ARIVIE_OWNER_ID,
    version: process.env.ARIVIE_VERSION,
  };

  const url = process.env.DATABASE_URL;
  if (url) {
    const { postgresAdapter } = await import("@arivie/db-postgres");
    opts.db = postgresAdapter({ url });
  }

  const semanticPath = process.env.ARIVIE_SEMANTIC_PATH;
  if (semanticPath) {
    const { loadSemanticLayer } = await import("@arivie/semantic");
    opts.semantic = await loadSemanticLayer(semanticPath);
  }

  return opts;
}

const mcp = makeMcpServer(await resolveOptions());
await startStdioServer({ mcp });
