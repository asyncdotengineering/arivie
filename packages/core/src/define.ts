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
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { Hono } from "hono";
import { z } from "zod";
import { ArivieConfigSchema } from "./config.js";
import { runWithUserContext } from "./context.js";
import { ArivieConfigError } from "./errors.js";
import { makeWebHandler } from "./handler.js";
import { resolveSources } from "./sources.js";
import type {
  ArivieConfig,
  ArivieInstance,
  AskOptions,
  AskResult,
  ToolCallTrace,
} from "./types.js";

export { ArivieConfigError } from "./errors.js";

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

  const { sources, mcpTools, metadata: sourceMetadata } = await resolveSources(
    parsed.sources,
  );
  // Infrastructure connection (Mastra Memory + owner identity) lives on
  // its own slot — independent of user-named domain sources.
  const storage = parsed.storage;

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

  const mastraStorage = new PostgresStore({
    id: `arivie-${parsed.owner.id}`,
    connectionString: storage.url,
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
    sourceMetadata,
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

  // Build scheduled workflows for each ArivieSchedule. Each workflow has
  // one step that asks the Arivie agent as the owner user and a Mastra
  // cron schedule that supplies the prompt via inputData.
  const ownerUser = {
    userId: parsed.owner.id,
    permissions: ["read"],
    dbRole: "arivie_reader",
  };
  const scheduleWorkflows: Record<string, ReturnType<typeof createWorkflow>> =
    {};
  for (const schedule of parsed.schedules ?? []) {
    const step = createStep({
      id: `arivie-schedule-${schedule.id}`,
      description: `Scheduled Arivie run: ${schedule.prompt}`,
      inputSchema: z.object({ prompt: z.string() }),
      outputSchema: z.object({ text: z.string() }),
      execute: async ({ inputData }) => {
        const result = await runWithUserContext(ownerUser, async () =>
          agent.generate(inputData.prompt, {
            memory: {
              thread: `schedule-${schedule.id}`,
              resource: parsed.owner.id,
            },
          }),
        );
        const text =
          result != null && typeof result === "object" && "text" in result
            ? String(result.text)
            : "";
        return { text };
      },
    });

    const workflow = createWorkflow({
      id: `arivie-schedule-${schedule.id}`,
      description: `Arivie schedule: ${schedule.id}`,
      inputSchema: z.object({ prompt: z.string() }),
      outputSchema: z.object({ text: z.string() }),
      steps: [step],
      schedule: {
        cron: schedule.cron,
        ...(schedule.timezone !== undefined
          ? { timezone: schedule.timezone }
          : {}),
        inputData: { prompt: schedule.prompt },
        ...(schedule.metadata !== undefined
          ? { metadata: schedule.metadata }
          : {}),
      },
    });

    scheduleWorkflows[workflow.id] = workflow;
  }

  // Single agent registered as `arivie`. Mastra's storage flows through
  // to the agent's Memory because the Agent is constructed without an
  // explicit memory storage option (docs/memory/storage.mdx).
  const mastra = new Mastra({
    agents: { arivie: agent },
    storage: mastraStorage,
    workspace,
    mcpServers: { arivie: mcp },
    workflows: scheduleWorkflows,
    ...(parsed.observability !== undefined
      ? { observability: parsed.observability }
      : {}),
  });

  const handler = makeWebHandler({
    agent,
    db: storage,
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
    // storage.sql.end() exists on the real PostgresAdapter; some test
    // mocks ship a stub `sql: {}` without `.end`. Guard accordingly.
    if (typeof storage.sql?.end === "function") {
      await storage.sql.end();
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

    const result = await runWithUserContext(opts.user, async () =>
      agent.generate(opts.prompt, { memory: { thread, resource } }),
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
    /**
     * Web Standard request handler `(req: Request) => Promise<Response>`.
     * Drop into ANY web host that speaks Fetch — no framework adapter
     * needed.
     *
     *   Next.js App Router:  export const POST = arivie.handler;
     *   Bun:                 Bun.serve({ fetch: arivie.handler });
     *   Hono:                app.all("*", (c) => arivie.handler(c.req.raw));
     *   Cloudflare Worker:   export default { fetch: arivie.handler };
     *   TanStack Start:      return arivie.handler(request)  // in a server route
     */
    handler,
    /** Pre-wired Hono app — convenience for the Hono case. */
    hono: honoApp,
    dispose,
  };
}
