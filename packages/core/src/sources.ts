/* SPDX-License-Identifier: Apache-2.0 */
import type { MastraMCPServerDefinition } from "@mastra/mcp";
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
): entry is Extract<SourceConfigEntry, { kind: "mcp" }> {
  return entry != null && typeof entry === "object" && entry.kind === "mcp";
}

function isAdapterEntry(
  entry: SourceConfigEntry,
): entry is Extract<SourceConfigEntry, { kind: "adapter" }> {
  return (
    entry != null && typeof entry === "object" && entry.kind === "adapter"
  );
}

export function unwrapSourceEntry(
  entry: SourceConfigEntry,
): SourceAdapter<unknown> {
  if (isAdapterEntry(entry)) {
    return entry.adapter;
  }
  if (isMcpEntry(entry)) {
    throw new ArivieConfigError(
      "MCP source entries must be resolved via resolveSources() — use await resolveSources(config.sources)",
    );
  }
  throw new ArivieConfigError(
    'Invalid source entry — expected { kind: "adapter", adapter, description } or { kind: "mcp", mcp, description }',
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

function mcpEntryToServerConfig(
  mcp: MCPServerConfig,
): MastraMCPServerDefinition {
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
  entry: Extract<SourceConfigEntry, { kind: "mcp" }>,
): Promise<{
  adapter: SourceAdapter<unknown>;
  tools: Record<string, unknown>;
}> {
  let makeMCPSourceAdapter: (typeof import("@arivie/source-mcp"))["makeMCPSourceAdapter"];
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

/** @deprecated Use {@link resolveSources} for configs that may include MCP entries. */
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
