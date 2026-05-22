/* SPDX-License-Identifier: Apache-2.0 */
import { existsSync } from "node:fs";
import {
  autoDetectMode,
  makeAgent,
  type ContextMode,
} from "@arivie/agent";
import type { Tool } from "@mastra/core/tools";
import {
  loadSemanticLayerSync,
  ParseError,
  LoadError,
  type SemanticLayer,
} from "@arivie/semantic";
import { makeWorkspace } from "@arivie/workspace";
import { Mastra } from "@mastra/core";
import { MCPServer } from "@mastra/mcp";
import { PostgresStore } from "@mastra/pg";
import { Hono } from "hono";
import { z } from "zod";
import { bunHandler } from "./adapters/bun.js";
import { makeNextAdapter } from "./adapters/next.js";
import { workerHandler } from "./adapters/worker.js";
import { ArivieConfigSchema } from "./config.js";
import { runWithUserContext } from "./context.js";
import { ArivieConfigError } from "./errors.js";
import { makeWebHandler } from "./handler.js";
import {
  extractConnectionString,
  postgresAdapterFromSources,
  resolveSources,
} from "./sources.js";
import type {
  ArivieConfig,
  ArivieInstance,
  AskOptions,
  AskResult,
  ToolCallTrace,
} from "./types.js";

export { ArivieConfigError } from "./errors.js";

type MastraMcpServer = NonNullable<
  NonNullable<ConstructorParameters<typeof Mastra>[0]>["mcpServers"]
>[string];

function asMastraMcpServer(server: MCPServer): MastraMcpServer {
  return server as unknown as MastraMcpServer;
}

function emptySemanticLayer(): SemanticLayer {
  return {
    entities: new Map(),
    catalog: {
      entities: [],
      generated_at: new Date().toISOString(),
      source_files: [],
    },
  };
}

function isEnoent(err: unknown): boolean {
  return (
    err instanceof Error &&
    "code" in err &&
    (err as { code: string }).code === "ENOENT"
  );
}

function loadSemanticLayerAtFactory(rootDir: string): SemanticLayer {
  if (!existsSync(rootDir)) {
    console.warn(
      `[arivie] semantic layer dir not found at ${rootDir}; using empty layer`,
    );
    return emptySemanticLayer();
  }

  try {
    return loadSemanticLayerSync(rootDir);
  } catch (err: unknown) {
    if (err instanceof ParseError) {
      throw err;
    }
    if (err instanceof LoadError) {
      throw err;
    }
    if (isEnoent(err)) {
      console.warn(
        `[arivie] semantic layer dir not found at ${rootDir}; using empty layer`,
      );
      return emptySemanticLayer();
    }
    throw err;
  }
}

function resolveContextMode(
  mode: ArivieConfig["semantic"]["mode"],
  semantic: SemanticLayer,
): ContextMode {
  if (mode === "auto") {
    return autoDetectMode(semantic);
  }
  return mode;
}

function workspaceRootDir(parsed: ArivieConfig): string {
  return parsed.workspace?.rootDir ?? parsed.semantic.path;
}

/**
 * Walk a Mastra `agent.generate(...)` response and extract the
 * tool-call trace, the SQL that was run, and the artifacts that were
 * written — without forcing every caller to do their own
 * `Record<string, unknown>` walk.
 */
function extractAskResult(result: unknown, text: string): AskResult {
  const toolCalls: ToolCallTrace[] = [];
  const sql: string[] = [];
  const artifacts: string[] = [];

  const record = result as Record<string, unknown>;
  const response = record.response as { messages?: unknown[] } | undefined;
  const messages = Array.isArray(response?.messages) ? response.messages : [];

  const pendingByIdx = new Map<number, ToolCallTrace>();
  let callIdx = 0;

  for (const msg of messages) {
    if (msg == null || typeof msg !== "object") continue;
    const parts = Array.isArray((msg as { content?: unknown }).content)
      ? ((msg as { content: unknown[] }).content)
      : [];
    for (const part of parts) {
      if (part == null || typeof part !== "object") continue;
      const p = part as Record<string, unknown>;
      const type = String(p.type ?? "");
      if (type === "tool-call") {
        const tool = String(p.toolName ?? "?");
        const args = (p.input ?? p.args ?? {}) as Record<string, unknown>;
        const trace: ToolCallTrace = { tool, args };
        pendingByIdx.set(callIdx, trace);
        toolCalls.push(trace);

        if (tool.startsWith("execute_")) {
          const stmt = args.sql;
          if (typeof stmt === "string") sql.push(stmt);
        }
        if (tool === "mastra_workspace_write_file") {
          const p = args.path;
          if (typeof p === "string") artifacts.push(p);
        }
      } else if (type === "tool-result") {
        const trace = pendingByIdx.get(callIdx);
        if (trace !== undefined) {
          const out = (p.output ?? p.result ?? {}) as Record<string, unknown>;
          trace.output = out;
          pendingByIdx.delete(callIdx);
        }
        callIdx += 1;
      }
    }
  }

  return { text, toolCalls, sql, artifacts, raw: result };
}

export async function defineArivie(
  config: ArivieConfig,
): Promise<ArivieInstance> {
  let parsed: ArivieConfig;
  try {
    parsed = ArivieConfigSchema.parse(config) as ArivieConfig;
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new ArivieConfigError("Invalid Arivie config", { cause: err });
    }
    throw err;
  }

  const { sources, mcpTools } = await resolveSources(parsed.sources);
  const postgres = postgresAdapterFromSources(sources);

  const semantic =
    parsed.semantic.layer ??
    loadSemanticLayerAtFactory(parsed.semantic.path);
  const contextMode = resolveContextMode(parsed.semantic.mode, semantic);

  if (contextMode === "indexed" && parsed.semantic.embeddings === undefined) {
    throw new ArivieConfigError(
      "semantic.embeddings is required when mode is 'indexed' or auto-resolves to indexed",
    );
  }

  const workspaceCfg = parsed.workspace ?? {};
  const { workspace, bashTool, skillsProcessor, effectiveSkillsMode } = await makeWorkspace({
    rootDir: workspaceRootDir(parsed),
    ...(workspaceCfg.filesystem !== undefined
      ? { filesystem: workspaceCfg.filesystem }
      : {}),
    ...(parsed.skills !== undefined ? { skills: parsed.skills } : {}),
    ...(workspaceCfg.bm25 !== undefined ? { bm25: workspaceCfg.bm25 } : {}),
    ...(parsed.skillsMode !== undefined
      ? { skillsMode: parsed.skillsMode }
      : {}),
    ...(workspaceCfg.bash === true ? { tools: ["bash"] as const } : {}),
    ...(workspaceCfg.finalizeReport !== undefined
      ? { finalizeReport: workspaceCfg.finalizeReport }
      : {}),
  });

  const storage = new PostgresStore({
    id: `arivie-${parsed.owner.id}`,
    connectionString: extractConnectionString(postgres),
  });

  // Single agent: text-to-SQL + workspace tools on one model. No
  // supervisor, no sub-agents. The agent that runs `execute_<source>` is
  // the same agent that calls `mastra_workspace_write_file` to land an
  // HTML or CSV artifact — rows stay in one scratchpad end-to-end.
  // Pattern matches production text-to-SQL agents (Dataherald, Vanna)
  // where coder-style capabilities are tools on the agent, not delegated
  // sub-agents that re-verbalize data through prose.
  const agent = makeAgent({
    ownerId: parsed.owner.id,
    model: parsed.model,
    semantic,
    contextMode,
    sources,
    mcpTools: mcpTools as Record<string, Tool>,
    workspace,
    skillsProcessor,
    skillsMode: effectiveSkillsMode,
    ...(bashTool !== undefined ? { bashTool } : {}),
    compileMetric: parsed.compileMetric ?? false,
    ...(contextMode === "indexed" && parsed.semantic.embeddings !== undefined
      ? {
          vector: parsed.semantic.embeddings.vector,
          provider: parsed.semantic.embeddings.provider,
          indexName: parsed.semantic.embeddings.indexName,
        }
      : {}),
    ...(parsed.limits !== undefined ? { limits: parsed.limits } : {}),
    ...(parsed.hooks !== undefined ? { hooks: parsed.hooks } : {}),
    config: {
      compile_metric: parsed.compileMetric ?? false,
      workspace: {
        finalizeReport: workspaceCfg.finalizeReport ?? true,
      },
    },
  });

  const mcp = new MCPServer({
    id: `arivie-${parsed.owner.id}`,
    name: "Arivie MCP",
    version: "0.0.0",
    description: "Arivie MCP server (Sprint 0 stub)",
    instructions: "Sprint 0 stub — tools attach in Sprint 3",
    tools: {},
  });

  // Single agent registered as `arivie`. Mastra's storage flows through
  // to the agent's Memory because the Agent is constructed without an
  // explicit memory storage option (docs/memory/storage.mdx).
  const mastra = new Mastra({
    agents: { arivie: agent },
    storage,
    workspace,
    mcpServers: { arivie: asMastraMcpServer(mcp) },
  });

  const handler = makeWebHandler({
    agent,
    db: postgres,
    config: parsed,
  });

  const honoApp = new Hono();
  honoApp.all("*", async (c) => handler(c.req.raw));

  async function dispose(): Promise<void> {
    for (const adapter of Object.values(sources)) {
      if (adapter.close != null) {
        await adapter.close();
      }
    }
  }

  /**
   * Typed one-shot facade. Sets the AsyncLocalStorage user context the
   * `execute_<source>` tool needs, generates a per-turn thread ID if the
   * caller didn't supply one, and walks the Mastra response into a strict
   * {@link AskResult} so callers don't fight `unknown` types.
   */
  async function ask(opts: AskOptions): Promise<AskResult> {
    const thread =
      opts.thread ??
      `arivie-${new Date().toISOString().replace(/[:.]/g, "").slice(0, 17)}`;
    const resource = opts.resource ?? opts.user.userId;

    // Mastra's generate signature accepts `{ memory: { thread, resource } }`
    // among many other options. `applyMaxStepsDefault` (in make-agent.ts)
    // patches `agent.generate` at runtime; the static signature at this
    // consumer site narrows to a one-arg overload. We re-type to Mastra's
    // real two-arg shape here so the cast lives inside the framework, not
    // in user code — every user that doesn't use `ask()` would otherwise
    // have to write it themselves.
    //
    // Note: we MUST call this as `agent.generate(...)` (method dispatch),
    // not via a hoisted variable, because Mastra reads `this._Agent` at
    // call time and an unbound reference loses it.
    type LooseGen = (
      prompt: string,
      options: { memory: { thread: string; resource: string } },
    ) => Promise<unknown>;
    const result = await runWithUserContext(opts.user, async () =>
      (agent.generate as unknown as LooseGen).call(
        agent,
        opts.prompt,
        { memory: { thread, resource } },
      ),
    );

    const record = result as Record<string, unknown>;
    const text = typeof record.text === "string" ? record.text : "";
    return extractAskResult(result, text);
  }

  return {
    agent,
    ask,
    mastra,
    workspace,
    handler,
    next: makeNextAdapter(handler),
    hono: honoApp,
    bun: bunHandler({ handler }),
    worker: workerHandler({ handler }),
    dispose,
  };
}
