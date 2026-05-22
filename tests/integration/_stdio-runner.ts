/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Stdio MCP entrypoint for S3-03 parity tests.
 * Spawned by MCPClient; reads DB + semantic paths from env set in mcp-parity.test.ts.
 */
import { makeAgent } from "@arivie/agent";
import { runWithUserContext, setCurrentUserContext } from "@arivie/core/context";
import { postgresAdapter } from "@arivie/db-postgres";
import { loadSemanticLayerSync } from "@arivie/semantic";
import { makeMcpServer } from "@arivie/mcp";
import { startStdioServer } from "@arivie/mcp/stdio";
import { Mastra } from "@mastra/core";
import { PostgresStore } from "@mastra/pg";
import { createParityMockModel } from "../../scripts/parity-mock-model.js";

const pgUrl = process.env.ARIVIE_TEST_PG_URL;
const semDir = process.env.ARIVIE_TEST_SEM_DIR;

if (pgUrl == null || pgUrl.length === 0) {
  console.error("ARIVIE_TEST_PG_URL is required");
  process.exit(1);
}
if (semDir == null || semDir.length === 0) {
  console.error("ARIVIE_TEST_SEM_DIR is required");
  process.exit(1);
}

const parityUser = {
  userId: "parity-user",
  permissions: [] as string[],
  dbRole: "arivie_reader",
};

setCurrentUserContext(parityUser);

const db = postgresAdapter({ url: pgUrl });
const semantic = loadSemanticLayerSync(semDir);
const model = createParityMockModel();

const agent = makeAgent({
  ownerId: "parity-owner",
  model,
  semantic,
  contextMode: "preload",
  db,
  limits: { rowsPerQuery: 500, queryTimeoutMs: 30_000 },
});

/** Align MCP ask's `generate(prompt)` with HTTP handler semantics (memory + user context). */
const generate = agent.generate.bind(agent);
agent.generate = ((
  prompt: string | { role: string; content: string }[],
  options?: Parameters<typeof generate>[1],
) => {
  const messages =
    typeof prompt === "string"
      ? [{ role: "user" as const, content: prompt }]
      : prompt;
  const memory = {
    thread: options?.memory?.thread ?? "parity-mcp",
    resource: options?.memory?.resource ?? parityUser.userId,
  };
  return runWithUserContext(parityUser, () =>
    generate(messages, { ...options, memory }),
  );
}) as typeof agent.generate;

const storage = new PostgresStore({
  id: "arivie-parity-owner",
  connectionString: pgUrl,
});

// Mastra wires agent memory to PostgresStore (same pattern as defineArivie).
const _mastra = new Mastra({
  agents: { arivie: agent },
  storage,
});

if (
  storage != null &&
  "init" in storage &&
  typeof storage.init === "function"
) {
  await storage.init();
}

const mcp = makeMcpServer({
  agent,
  semantic,
  db,
  ownerId: "parity-owner",
  ownerName: "Parity",
});

await agent.generate("warmup");

await startStdioServer({ mcp });
