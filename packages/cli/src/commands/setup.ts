/* SPDX-License-Identifier: Apache-2.0 */
import { existsSync } from "node:fs";
import type { ArivieConfig } from "@arivie/core/types";
import { autoDetectMode } from "@arivie/agent";
import type { PostgresAdapter } from "@arivie/db-postgres";
import { buildIndex } from "@arivie/embeddings";
import { loadSemanticLayerSync } from "@arivie/semantic";
import { PostgresStore } from "@mastra/pg";
import { defineCommand } from "citty";
import { loadArivieConfig } from "../lib/load-config.js";
import { postgresAdapterFromConfig } from "../lib/postgres-from-config.js";
import { printCliCommandError } from "../lib/cli-errors.js";

const READER_ROLE = "arivie_reader";

export interface SetupResult {
  roleMessage: string;
  mastraMessage: string;
  indexMessage?: string;
  ownerMessage: string;
}

async function roleExists(adapter: PostgresAdapter, role: string): Promise<boolean> {
  const rows = await adapter.sql<{ exists: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${role}) AS exists
  `;
  return rows[0]?.exists === true;
}

async function countMastraTables(adapter: PostgresAdapter): Promise<number> {
  const rows = await adapter.sql<{ count: string }[]>`
    SELECT COUNT(*)::text AS count
    FROM pg_tables
    WHERE schemaname = 'public' AND tablename LIKE 'mastra_%'
  `;
  return Number(rows[0]?.count ?? 0);
}

async function ensureOwnerIdentity(
  adapter: PostgresAdapter,
  ownerId: string,
): Promise<"verified" | "inserted"> {
  const rows = await adapter.sql<{ value: string }[]>`
    SELECT value FROM arivie_owner_identity WHERE key = 'owner_id'
  `;
  const existing = rows[0]?.value;
  if (existing !== ownerId) {
    await adapter.sql`
      INSERT INTO arivie_owner_identity (key, value)
      VALUES ('owner_id', ${ownerId})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `;
    await adapter.verifyOwnerIdentity(ownerId);
    return existing === undefined ? "inserted" : "inserted";
  }
  await adapter.verifyOwnerIdentity(ownerId);
  return "verified";
}

function resolveEffectiveMode(config: ArivieConfig): "preload" | "indexed" {
  if (config.semantic.mode !== "auto") {
    return config.semantic.mode;
  }
  const semanticRoot = config.semantic.path;
  if (!existsSync(semanticRoot)) {
    return "preload";
  }
  const layer = loadSemanticLayerSync(semanticRoot);
  return autoDetectMode(layer);
}

/**
 * Idempotent project setup (role, Mastra memory, optional RAG index, owner identity).
 * @see RFC-002 §4.12
 */
export async function runSetup(config: ArivieConfig): Promise<SetupResult> {
  const adapter = postgresAdapterFromConfig(config);
  const roleExisted = await roleExists(adapter, READER_ROLE);

  await adapter.setupRole(READER_ROLE);
  const roleMessage = roleExisted
    ? `✓ ${READER_ROLE} role: no-op (already exists)`
    : `✓ ${READER_ROLE} role created (or already exists)`;

  const mastraBefore = await countMastraTables(adapter);
  const storage = new PostgresStore({
    id: `arivie-${config.owner.id}`,
    connectionString: adapter.url,
  });
  try {
    await storage.init();
  } finally {
    if (
      "close" in storage &&
      typeof storage.close === "function"
    ) {
      await storage.close();
    }
  }
  const mastraAfter = await countMastraTables(adapter);
  const mastraMessage =
    mastraAfter > mastraBefore
      ? "✓ Mastra Memory migrations applied"
      : "✓ Mastra Memory: no migrations to apply";

  let indexMessage: string | undefined;
  const effectiveMode = resolveEffectiveMode(config);
  if (effectiveMode === "indexed") {
    if (config.semantic.embeddings == null) {
      throw new Error(
        "semantic.embeddings is required when mode resolves to indexed; export a full config for setup",
      );
    }
    const layer = loadSemanticLayerSync(config.semantic.path);
    await buildIndex({
      layer,
      provider: config.semantic.embeddings.provider,
      vector: config.semantic.embeddings.vector,
      indexName: config.semantic.embeddings.indexName,
    });
    indexMessage = `✓ Embedding index built (mode=indexed)`;
  }

  const ownerState = await ensureOwnerIdentity(adapter, config.owner.id);
  const ownerMessage =
    ownerState === "inserted"
      ? `✓ Owner identity verified: ${config.owner.id}`
      : `✓ Owner identity: ok`;

  return {
    roleMessage,
    mastraMessage,
    ...(indexMessage !== undefined ? { indexMessage } : {}),
    ownerMessage,
  };
}

export const setupCommand = defineCommand({
  meta: {
    name: "setup",
    description:
      "Create DB role, run Mastra Memory migrations, optional RAG index, owner smoke test",
  },
  args: {
    config: {
      type: "string",
      description: "Path to arivie.config.ts",
      default: "./arivie.config.ts",
    },
  },
  async run({ args }) {
    try {
      const config = await loadArivieConfig(args.config);
      const result = await runSetup(config);
      console.log(result.roleMessage);
      console.log(result.mastraMessage);
      if (result.indexMessage != null) {
        console.log(result.indexMessage);
      }
      console.log(result.ownerMessage);
      return 0;
    } catch (err) {
      printCliCommandError("setup", err);
      return 1;
    }
  },
});
