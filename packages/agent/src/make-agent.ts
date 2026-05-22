/* SPDX-License-Identifier: Apache-2.0 */
import type { LifecycleHooks, LimitConfig, SourceAdapter } from "@arivie/core/types";
import type { PostgresAdapter } from "@arivie/db-postgres";
import type { EmbeddingProvider } from "@arivie/embeddings";
import type { SemanticLayer } from "@arivie/semantic";
import { Agent } from "@mastra/core/agent";
import type {
  InputProcessorOrWorkflow,
  SkillSearchProcessor,
  SkillsProcessor,
} from "@mastra/core/processors";
import type { Workspace } from "@mastra/core/workspace";
import { Memory } from "@mastra/memory";
import type { LanguageModel } from "ai";
import { createTool, type Tool } from "@mastra/core/tools";
import { z } from "zod";
import { getCurrentUserContext } from "@arivie/core/context";

import { assertToolShape, type AssertToolShapeConfig } from "./contract-invariants.js";
import { buildSystemPrompt, type ContextMode, type SkillsMode } from "./prompt.js";
import { compileMetricFor } from "./tools/compile-metric.js";
import {
  finalizeReportStopWhen,
  finalizeReportTool,
  shouldRegisterFinalizeReport,
} from "./tools/finalize-report.js";
import { executeToolFor } from "./tools/execute.js";

export interface MakeAgentOptions {
  ownerId: string;
  model: LanguageModel;
  semantic: SemanticLayer;
  contextMode: ContextMode;
  sources: Record<string, SourceAdapter<unknown>>;
  workspace: Workspace;
  skillsProcessor?: SkillsProcessor | SkillSearchProcessor;
  vector?: import("@mastra/core/vector").MastraVector;
  provider?: EmbeddingProvider;
  indexName?: string;
  limits?: LimitConfig;
  hooks?: LifecycleHooks;
  compileMetric?: boolean;
  mcpTools?: Record<string, Tool>;
  bashTool?: Tool;
  /**
   * How skills are presented to the agent. Drives whether the prompt
   * renders the eager or on-demand SKILL_DISCIPLINE block. Defaults to
   * `"none"` when skills are not attached; consumers (e.g. `defineArivie`)
   * should pass the value returned by `makeWorkspace`.
   */
  skillsMode?: SkillsMode;
  config: AssertToolShapeConfig;
}

const DEFAULT_MAX_STEPS = 25;

function applyMaxStepsDefault(agent: Agent, maxSteps: number): Agent {
  const originalGenerate = agent.generate.bind(agent);
  const originalStream = agent.stream.bind(agent);
  type GenLike = (
    ...args: [unknown, Record<string, unknown> | undefined]
  ) => unknown;
  const withDefault = (fn: GenLike): GenLike => {
    return (messages, options) => {
      const merged = {
        ...(options ?? {}),
        maxSteps:
          options != null && "maxSteps" in options && options.maxSteps != null
            ? options.maxSteps
            : maxSteps,
      };
      return fn(messages, merged);
    };
  };
  // Mastra Agent typings omit maxSteps on generate/stream; patch via narrow unknown bridge.
  (agent as unknown as { generate: GenLike }).generate = withDefault(
    originalGenerate as unknown as GenLike,
  );
  (agent as unknown as { stream: GenLike }).stream = withDefault(
    originalStream as unknown as GenLike,
  );
  return agent;
}

function asPostgresAdapter(adapter: SourceAdapter<unknown>): PostgresAdapter {
  if (adapter.kind !== "postgres" || !("url" in adapter) || !("sql" in adapter)) {
    throw new Error("expected postgres SourceAdapter");
  }
  return adapter as unknown as PostgresAdapter;
}

function executeMcpSourceToolFor({
  source,
  sourceName,
  ownerId,
  limits,
  hooks,
}: {
  source: SourceAdapter<unknown>;
  sourceName: string;
  ownerId: string;
  limits: LimitConfig;
  hooks?: LifecycleHooks;
}) {
  const rowLimit = limits.rowsPerQuery ?? 50;
  const timeoutMs = limits.queryTimeoutMs ?? 30_000;
  const toolId = `execute_${sourceName}`;

  return createTool({
    id: toolId,
    description: `Run an MCP tool on source "${sourceName}" via toolName and args.`,
    inputSchema: z.object({
      toolName: z.string().describe("Underlying MCP tool name (not namespaced)"),
      args: z
        .record(z.string(), z.unknown())
        .default({})
        .describe("Arguments forwarded to the MCP tool"),
    }),
    execute: async ({ toolName, args }) => {
      const user = getCurrentUserContext();
      if (user == null) {
        throw new Error("no user context — auth resolver did not run");
      }

      const queryLabel = `${toolName}(${JSON.stringify(args)})`;
      await hooks?.onBeforeQuery?.({
        sql: queryLabel,
        userId: user.userId,
        ownerId,
      });

      const credentials = user.credentials?.[sourceName];
      const result = await source.execute({
        query: { toolName, args },
        runAsRole: user.dbRole,
        userId: user.userId,
        rowLimit,
        timeoutMs,
        ...(credentials !== undefined ? { credentials } : {}),
      });

      await hooks?.onAfterQuery?.({
        sql: queryLabel,
        rows: result.rows,
        durationMs: result.durationMs,
        userId: user.userId,
        ownerId,
      });

      return {
        rows: result.rows,
        rowCount: result.rowCount,
        truncated: result.truncated,
      };
    },
  });
}

function executeAdapterSourceToolFor({
  source,
  sourceName,
  ownerId,
  limits,
  hooks,
}: {
  source: SourceAdapter<unknown>;
  sourceName: string;
  ownerId: string;
  limits: LimitConfig;
  hooks?: LifecycleHooks;
}) {
  const rowLimit = limits.rowsPerQuery ?? 50;
  const timeoutMs = limits.queryTimeoutMs ?? 30_000;
  const toolId = `execute_${sourceName}`;

  return createTool({
    id: toolId,
    description: `Execute a ${source.kind} query on source "${sourceName}".`,
    inputSchema: z.object({
      query: z
        .record(z.string(), z.unknown())
        .describe(`Adapter-specific query payload for ${source.kind}`),
    }),
    execute: async ({ query }) => {
      const user = getCurrentUserContext();
      if (user == null) {
        throw new Error("no user context — auth resolver did not run");
      }

      const queryLabel = JSON.stringify(query);
      await hooks?.onBeforeQuery?.({
        sql: queryLabel,
        userId: user.userId,
        ownerId,
      });

      const credentials = user.credentials?.[sourceName];
      const result = await source.execute({
        query,
        runAsRole: user.dbRole,
        userId: user.userId,
        rowLimit,
        timeoutMs,
        ...(credentials !== undefined ? { credentials } : {}),
      });

      await hooks?.onAfterQuery?.({
        sql: queryLabel,
        rows: result.rows,
        durationMs: result.durationMs,
        userId: user.userId,
        ownerId,
      });

      return {
        rows: result.rows,
        rowCount: result.rowCount,
        truncated: result.truncated,
      };
    },
  });
}

// TODO (v0.3 RFC-003 §13 amendment B-v02-EXECUTE-DISPATCH):
// `execute_<sourceName>` per-kind dispatch (postgres / mcp / mixpanel) doesn't scale.
// v0.3 should generalize via `adapter.getExecuteSchema(): z.ZodSchema` on the
// SourceAdapter contract, so each adapter declares its own input shape.

function executeSourceToolFor({
  source,
  sourceName,
  ownerId,
  limits,
  hooks,
}: {
  source: SourceAdapter<unknown>;
  sourceName: string;
  ownerId: string;
  limits: LimitConfig;
  hooks?: LifecycleHooks;
}) {
  if (source.kind === "mcp") {
    return executeMcpSourceToolFor({
      source,
      sourceName,
      ownerId,
      limits,
      ...(hooks !== undefined ? { hooks } : {}),
    });
  }

  return executeAdapterSourceToolFor({
    source,
    sourceName,
    ownerId,
    limits,
    ...(hooks !== undefined ? { hooks } : {}),
  });
}

/**
 * Build the Arivie analytics agent.
 *
 * Single agent surface: text-to-SQL over the semantic layer + workspace
 * tools (read/write/grep/edit + opt-in bash). No supervisor, no
 * sub-agents. The agent that runs the SQL is the same agent that writes
 * files — keeping rows inside one model's scratchpad eliminates the
 * fabrication boundary that prose-handoff between a supervisor and a
 * coder sub-agent introduces.
 *
 * Convergence with production analytics agents: Dataherald (single ReAct
 * + tools), Vanna (single agent with `run_sql`+`visualize_data` as tools,
 * not sub-agents), WrenAI (typed workflow with deterministic steps). The
 * supervisor + agents-as-tools pattern is the right default for genuinely
 * heterogeneous specialist routing (research+writing), not for analytics
 * where the work is one LLM, multiple tools.
 */
export function makeAgent(opts: MakeAgentOptions): Agent {
  const limits = opts.limits ?? {};
  const compileMetric = opts.compileMetric ?? false;
  const sourceNames = Object.keys(opts.sources);

  const tools: Record<string, unknown> = {};

  for (const [name, source] of Object.entries(opts.sources)) {
    if (source.kind === "postgres") {
      tools[`execute_${name}`] = executeToolFor({
        db: asPostgresAdapter(source),
        ownerId: opts.ownerId,
        sourceName: name,
        limits,
        toolId: `execute_${name}`,
        ...(opts.hooks !== undefined ? { hooks: opts.hooks } : {}),
      });
    } else {
      tools[`execute_${name}`] = executeSourceToolFor({
        source,
        sourceName: name,
        ownerId: opts.ownerId,
        limits,
        ...(opts.hooks !== undefined ? { hooks: opts.hooks } : {}),
      });
    }
  }

  if (compileMetric) {
    tools.compile_metric = compileMetricFor({
      semantic: opts.semantic,
      sources: opts.sources,
      ownerId: opts.ownerId,
      limits,
      ...(opts.hooks !== undefined ? { hooks: opts.hooks } : {}),
    });
  }

  if (opts.mcpTools != null) {
    Object.assign(tools, opts.mcpTools);
  }

  const registerFinalizeReport = shouldRegisterFinalizeReport(
    opts.workspace,
    opts.config.workspace.finalizeReport,
  );
  if (registerFinalizeReport) {
    tools.finalize_report = finalizeReportTool();
  }

  if (opts.bashTool !== undefined) {
    tools.workspace_bash = opts.bashTool;
  }

  assertToolShape({
    tools,
    config: opts.config,
    sourceNames,
    workspace: opts.workspace,
  });

  const agentConfig: ConstructorParameters<typeof Agent>[0] = {
    id: `arivie-${opts.ownerId}`,
    name: "Arivie",
    description:
      "Single-tenant data analytics agent. Translates business questions " +
      "into read-only SQL against a semantic layer; writes file artifacts " +
      "(reports, CSVs) directly through workspace tools.",
    model: opts.model as ConstructorParameters<typeof Agent>[0]["model"],
    instructions: buildSystemPrompt({
      mode: opts.contextMode,
      semantic: opts.semantic,
      compileMetricEnabled: compileMetric,
      sources: sourceNames,
      hasFinalizeReport: registerFinalizeReport,
      skillsMode: opts.skillsMode ?? "none",
    }),
    tools: tools as NonNullable<
      ConstructorParameters<typeof Agent>[0]["tools"]
    >,
    workspace: opts.workspace,
    memory: new Memory(),
  };

  if (opts.skillsProcessor !== undefined) {
    agentConfig.inputProcessors = [
      opts.skillsProcessor as InputProcessorOrWorkflow,
    ];
  }

  if (registerFinalizeReport) {
    agentConfig.defaultOptions = { stopWhen: finalizeReportStopWhen };
  }

  const agent = new Agent(agentConfig) as Agent;

  // Mastra replaces stopWhen with stepCountIs(maxSteps) when maxSteps is set on stream/generate.
  if (registerFinalizeReport) {
    return agent;
  }

  const maxSteps = limits.maxSteps ?? DEFAULT_MAX_STEPS;
  return applyMaxStepsDefault(agent, maxSteps);
}
