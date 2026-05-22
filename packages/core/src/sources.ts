/* SPDX-License-Identifier: Apache-2.0 */
import type { MastraMCPServerDefinition } from "@mastra/mcp";
import type { PostgresAdapter } from "@arivie/db-postgres";
import { ArivieConfigError } from "./errors.js";
import type {
  MCPServerConfig,
  SourceAdapter,
  SourceConfigEntry,
  SourceMetadata,
  SourcesConfig,
} from "./types.js";

function isMcpEntry(
  entry: SourceConfigEntry,
): entry is { mcp: MCPServerConfig; description: string; useWhen?: string } {
  return (
    entry != null &&
    typeof entry === "object" &&
    "mcp" in entry &&
    !("adapter" in entry)
  );
}

export function unwrapSourceEntry(entry: SourceConfigEntry): SourceAdapter<unknown> {
  if (
    entry != null &&
    typeof entry === "object" &&
    "adapter" in entry &&
    entry.adapter != null
  ) {
    return entry.adapter;
  }
  if (isMcpEntry(entry)) {
    throw new ArivieConfigError(
      "MCP source entries must be resolved via resolveSources() — use await resolveSources(config.sources)",
    );
  }
  throw new ArivieConfigError(
    "Invalid source entry — expected { adapter, description } or { mcp, description }",
  );
}

/** Pull description + useWhen off a source entry for prompt assembly. */
export function readSourceMetadata(
  name: string,
  entry: SourceConfigEntry,
): SourceMetadata {
  if (entry == null || typeof entry !== "object" || !("description" in entry)) {
    throw new ArivieConfigError(
      `sources.${name}: missing required "description" — one sentence on what's in this source`,
    );
  }
  return {
    name,
    description: entry.description,
    ...(typeof (entry as { useWhen?: string }).useWhen === "string"
      ? { useWhen: (entry as { useWhen?: string }).useWhen }
      : {}),
  };
}

function mcpEntryToServerConfig(mcp: MCPServerConfig): MastraMCPServerDefinition {
  if (mcp.url != null && mcp.url.length > 0) {
    return { url: new URL(mcp.url) };
  }
  if (mcp.command == null || mcp.command.length === 0) {
    throw new ArivieConfigError(
      "MCP server config requires either url or command",
    );
  }
  return {
    command: mcp.command,
    args: mcp.args ?? [],
    ...(mcp.env !== undefined ? { env: mcp.env } : {}),
  };
}

function isModuleNotFound(err: unknown): boolean {
  return (
    err instanceof Error &&
    "code" in err &&
    (err as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND"
  );
}

/** Maps dynamic-import failures to actionable config errors (testable). */
export function wrapMcpImportError(err: unknown): never {
  if (isModuleNotFound(err)) {
    throw new ArivieConfigError(
      "MCP source declared but @arivie/source-mcp is not installed. Install it with: pnpm add @arivie/source-mcp",
      { cause: err },
    );
  }
  throw err;
}

async function resolveMcpEntry(
  name: string,
  entry: { mcp: MCPServerConfig },
): Promise<{
  adapter: SourceAdapter<unknown>;
  tools: Record<string, unknown>;
}> {
  let makeMCPSourceAdapter: typeof import("@arivie/source-mcp")["makeMCPSourceAdapter"];
  try {
    ({ makeMCPSourceAdapter } = await import("@arivie/source-mcp"));
  } catch (err: unknown) {
    wrapMcpImportError(err);
  }
  const { adapter, tools } = await makeMCPSourceAdapter({
    name,
    serverConfig: mcpEntryToServerConfig(entry.mcp),
  });
  return { adapter, tools };
}

export interface ResolvedSources {
  sources: Record<string, SourceAdapter<unknown>>;
  mcpTools: Record<string, unknown>;
  metadata: SourceMetadata[];
}

export async function resolveSources(
  sources: SourcesConfig,
): Promise<ResolvedSources> {
  const out: Record<string, SourceAdapter<unknown>> = {};
  const mcpTools: Record<string, unknown> = {};
  const metadata: SourceMetadata[] = [];
  for (const [name, entry] of Object.entries(sources)) {
    metadata.push(readSourceMetadata(name, entry));
    if (isMcpEntry(entry)) {
      const resolved = await resolveMcpEntry(name, entry);
      out[name] = resolved.adapter;
      Object.assign(mcpTools, resolved.tools);
    } else {
      out[name] = unwrapSourceEntry(entry);
    }
  }
  return { sources: out, mcpTools, metadata };
}

/** @deprecated Use {@link resolveSources} for configs that may include `{ mcp }` entries. */
export function normalizeSources(
  sources: SourcesConfig,
): Record<string, SourceAdapter<unknown>> {
  const out: Record<string, SourceAdapter<unknown>> = {};
  for (const [name, entry] of Object.entries(sources)) {
    if (isMcpEntry(entry)) {
      throw new ArivieConfigError(
        `sources.${name}: MCP entries require resolveSources()`,
      );
    }
    out[name] = unwrapSourceEntry(entry);
  }
  return out;
}

export function postgresAdapterFromSources(
  sources: Record<string, SourceAdapter<unknown>>,
): PostgresAdapter {
  const postgres = sources.postgres;
  if (postgres == null) {
    throw new ArivieConfigError(
      'sources must include a "postgres" entry for Mastra storage and owner verification in Sprint 0',
    );
  }
  if (postgres.kind !== "postgres") {
    throw new ArivieConfigError('sources.postgres must be a postgres SourceAdapter (kind: "postgres")');
  }
  if (!("url" in postgres) || !("sql" in postgres)) {
    throw new ArivieConfigError("sources.postgres must implement PostgresAdapter");
  }
  return postgres as unknown as PostgresAdapter;
}

export function extractConnectionString(adapter: PostgresAdapter): string {
  if (typeof adapter.url === "string" && adapter.url.length > 0) {
    return adapter.url;
  }
  throw new ArivieConfigError(
    "PostgresAdapter must expose a connection url for Mastra storage",
  );
}
