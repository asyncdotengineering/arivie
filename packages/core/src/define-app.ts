/* SPDX-License-Identifier: Apache-2.0 */
import { join } from "node:path";
import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core/mastra";
import { handleChatStream, type ChatStreamHandlerParams } from "@mastra/ai-sdk";
import { InMemoryStore } from "@mastra/core/storage";
import { LibSQLStore } from "@mastra/libsql";
import { Memory } from "@mastra/memory";
import type { Hono } from "hono";
import { createUIMessageStreamResponse, type LanguageModel } from "ai";
import { listConversationsFor } from "./runtime/conversations.js";
import { assertManifestValid } from "./manifest/validate.js";
import { buildManifest } from "./manifest/build.js";
import type { RuntimeManifest } from "./manifest/types.js";
import type { PluginInstance } from "./plugins/types.js";
import type { Tool } from "@mastra/core/tools";
import { assembleAgentContext } from "./runtime/assemble.js";
import {
  loadAppContext,
  usageModeOf,
  type LoadedContext,
} from "./runtime/context-layer.js";
import type { ContextRetriever } from "./runtime/context-retriever.js";
import { createMastraExecutor } from "./runtime/mastra-executor.js";
import { wrapInstructionsForCache } from "./runtime/prompt-cache.js";
import { resolveArivieDir } from "./runtime/storage-paths.js";
import { createRuntime } from "./runtime/session.js";
import type {
  AgentDefinition,
  CreateSessionInput,
  Runtime,
  UserContext,
} from "./runtime/types.js";
import type { ArivieEvent } from "./events/types.js";
import { createSessionApp } from "./server/routes/session.js";
import type { RuntimeStorage } from "./storage/types.js";

/** The Mastra storage backing conversation Memory (thread = runtime session). */
type MemoryStorage = NonNullable<
  ConstructorParameters<typeof Memory>[0]
>["storage"];

export interface ArivieAppConfig {
  app: { id: string; name: string; owner?: { id: string; name: string } };
  model: LanguageModel;
  storage: RuntimeStorage;
  plugins?: PluginInstance[];
  agents: Record<string, AgentDefinition>;
  /**
   * Declarative context layer (ADR 0003). `root` holds knowledge (`.md`) and
   * executable docs. `retriever` is the STRATEGY for `usage_mode: auto` pages —
   * pass `mastraRagRetriever({ embedding, vector })` (any Mastra store) or your
   * own `ContextRetriever` (any RAG pipeline). Absent → `always`-inject only.
   */
  context?: { root: string; retriever?: ContextRetriever };
  resolveUser: (req: Request) => Promise<UserContext> | UserContext;
  /**
   * Mastra storage backing agent conversation Memory. The runtime Session is
   * used as the Mastra thread, so multi-turn history persists through Mastra's
   * own Memory primitive. Defaults to a file-backed LibSQL store at
   * `.arivie/memory.db` (durable, zero-infra) so conversations survive restarts
   * and can be resumed; pass a `PostgresStore` (from `@mastra/pg`) for
   * production, or an `InMemoryStore` (from `@mastra/core/storage`) for
   * ephemeral/test use.
   */
  memory?: MemoryStorage;
}

/**
 * Zero-infra default memory — multi-cloud safe. A durable LibSQL file where the
 * filesystem is writable (`./.arivie` in dev, `<tmp>/arivie` on serverless), and
 * an in-memory store where it is not (no-FS runtimes like Cloudflare Workers).
 * Falling back lets the app boot anywhere; pass `memory:` with a hosted store
 * (PostgresStore / remote LibSQL / Upstash) for memory that persists across
 * serverless invocations.
 */
function defaultMemoryStore(): MemoryStorage {
  const dir = resolveArivieDir();
  if (dir === null) {
    console.warn(
      "[arivie] no writable filesystem — using in-memory conversation memory " +
        "(not persisted across invocations). Pass `memory:` with a durable store " +
        "for serverless persistence.",
    );
    return new InMemoryStore();
  }
  return new LibSQLStore({ id: "arivie-memory", url: `file:${join(dir, "memory.db")}` });
}

/** Input to the one-shot {@link ArivieApp.prompt} convenience. */
export interface PromptInput {
  agent: string;
  prompt: string;
  user: CreateSessionInput["user"];
  session?: CreateSessionInput["session"];
  /** Incremental model text as it streams. */
  onText?: (chunk: string) => void;
  /** A tool invocation (e.g. a SQL query). */
  onTool?: (tool: string, args: Record<string, unknown>) => void;
}

export interface ArivieApp {
  app: { id: string; name: string };
  manifest: RuntimeManifest;
  runtime: Runtime;
  /** Mastra storage backing conversation Memory — list/resume threads from it. */
  memory: MemoryStorage;
  /** The loaded declarative context layer (ADR 0003), or undefined if no `context` configured. */
  context?: LoadedContext;
  sessions: Runtime["sessions"];
  events: Runtime["events"];
  /**
   * Run one prompt to completion and return the agent's terminal text — the
   * thin convenience over `sessions.create` for scripts, the CLI, and one-shot
   * callers. Streams via the optional `onText`/`onTool` callbacks; throws if
   * the run fails. (RFC §12 Q3.)
   */
  prompt(input: PromptInput): Promise<string>;
  /** Web-standard request handler (POST /sessions, GET /runs/:id/events). */
  handler: (req: Request) => Promise<Response>;
  hono: Hono;
  dispose(): Promise<void>;
}

/** Build one Mastra agent from its definition + the compiled manifest. */
function buildMastraAgent(
  agentId: string,
  agent: AgentDefinition,
  manifest: RuntimeManifest,
  model: LanguageModel,
  memoryStorage: MemoryStorage,
  alwaysKnowledge: string[],
  contextTools: Record<string, Tool>,
): Agent {
  const { instructions, tools, workspace } = assembleAgentContext(
    agentId,
    agent,
    manifest,
    alwaysKnowledge,
  );
  const effectiveModel = agent.model ?? model;
  return new Agent({
    id: agentId,
    name: agentId,
    model: effectiveModel as ConstructorParameters<typeof Agent>[0]["model"],
    instructions: wrapInstructionsForCache(instructions, effectiveModel) as ConstructorParameters<typeof Agent>[0]["instructions"],
    // Plugin tools + the context-retriever's search tools (ADR 0003).
    tools: { ...tools, ...contextTools } as NonNullable<
      ConstructorParameters<typeof Agent>[0]["tools"]
    >,
    memory: new Memory({ storage: memoryStorage }),
    // Guardrails (PII / prompt-injection / moderation) run in Mastra's pipeline.
    ...(agent.inputProcessors !== undefined ? { inputProcessors: agent.inputProcessors } : {}),
    ...(agent.outputProcessors !== undefined ? { outputProcessors: agent.outputProcessors } : {}),
    ...(workspace !== undefined ? { workspace } : {}),
  });
}

/**
 * Build a domain-neutral Arivie app (RFC §4.1, §6.1). Compiles the plugin
 * manifest, builds one Mastra agent per `agents` entry (each scoped to the
 * tools + instruction fragments of the plugins backing its capabilities),
 * wires the Mastra executor into the durable runtime, and exposes the session
 * API + HTTP handler. Analytics, when present, is just one plugin.
 */
export async function defineArivie(config: ArivieAppConfig): Promise<ArivieApp> {
  const appMeta = { id: config.app.id, name: config.app.name };
  const { manifest, diagnostics } = await buildManifest({
    app: appMeta,
    plugins: config.plugins ?? [],
  });
  assertManifestValid(diagnostics);

  const memoryStorage = config.memory ?? defaultMemoryStore();

  // Declarative knowledge pillar (ADR 0003). `usage_mode: always` pages inject
  // into every agent; the loaded layer is exposed on the app for the context
  // tools + `arivie info`.
  const loadedContext = await loadAppContext(config);
  const alwaysKnowledge = loadedContext?.alwaysKnowledge ?? [];

  // `usage_mode: auto` retrieval (ADR 0003). The retriever indexes the
  // knowledge docs once and contributes search tools merged into every agent.
  let contextTools: Record<string, Tool> = {};
  const retriever = config.context?.retriever;
  if (retriever !== undefined && loadedContext !== undefined) {
    await retriever.index?.(loadedContext.documents);
    contextTools = retriever.tools();
  }

  // DX guard: knowledge concepts default to usage_mode "auto", which is ONLY
  // reachable through a ContextRetriever. With no retriever configured, auto
  // concepts load but never reach any agent — a silent no-op that surfaces as a
  // wrong answer in production rather than a config error. Warn at build time.
  if (retriever === undefined && loadedContext !== undefined) {
    const undeliverable = loadedContext.documents.filter(
      (doc) => doc.kind === "knowledge" && usageModeOf(doc) === "auto",
    );
    if (undeliverable.length > 0) {
      const shown = undeliverable.slice(0, 5).map((doc) => doc.id).join(", ");
      const more =
        undeliverable.length > 5 ? `, +${undeliverable.length - 5} more` : "";
      console.warn(
        `[arivie] ${undeliverable.length} knowledge concept(s) have usage_mode "auto" ` +
          `but no context.retriever is configured — they are loaded but will NOT reach any agent ` +
          `(${shown}${more}). Fix: configure context.retriever, or set "usage_mode: always" in the ` +
          `concept frontmatter to inject them into every agent.`,
      );
    }
  }

  const mastraAgents: Record<string, Agent> = {};
  for (const [id, agentDef] of Object.entries(config.agents)) {
    mastraAgents[id] = buildMastraAgent(
      id,
      agentDef,
      manifest,
      config.model,
      memoryStorage,
      alwaysKnowledge,
      contextTools,
    );
  }

  const executor = createMastraExecutor({ agents: mastraAgents });
  const runtime = createRuntime({
    storage: config.storage,
    agents: config.agents,
    executor,
  });

  // Hold a Mastra instance so we can lean on @mastra/ai-sdk for the AI SDK
  // useChat surface instead of hand-rolling an ArivieEvent → UIMessage bridge.
  const mastra = new Mastra({ agents: mastraAgents });
  const defaultAgentId = Object.keys(config.agents)[0];

  const hono = createSessionApp({ runtime, resolveUser: config.resolveUser });

  // AI SDK chat surface — what `@arivie/react`'s `ArivieChat` / `useChat` POST
  // to. `@mastra/ai-sdk` translates the agent stream to the UI message protocol.
  hono.post("/api/chat", async (c) => {
    const params = (await c.req.json().catch(() => ({}))) as ChatStreamHandlerParams & {
      agent?: unknown;
    };
    const requested = typeof params.agent === "string" ? params.agent : undefined;
    const agentId =
      requested !== undefined && requested in mastraAgents ? requested : defaultAgentId;
    if (agentId === undefined) return c.json({ error: "no agent defined" }, 400);
    const stream = await handleChatStream({ mastra, agentId, params, version: "v6" });
    return createUIMessageStreamResponse({ stream });
  });

  hono.get("/api/threads", async (c) => {
    const resourceId = c.req.query("resource") ?? c.req.query("resourceId");
    if (resourceId == null || resourceId === "") return c.json({ threads: [] });
    return c.json({ threads: await listConversationsFor(memoryStorage, resourceId) });
  });

  return {
    app: appMeta,
    manifest,
    runtime,
    memory: memoryStorage,
    ...(loadedContext !== undefined ? { context: loadedContext } : {}),
    sessions: runtime.sessions,
    events: runtime.events,
    async prompt(input: PromptInput): Promise<string> {
      const handle = await runtime.sessions.create({
        agent: input.agent,
        prompt: input.prompt,
        user: input.user,
        ...(input.session !== undefined ? { session: input.session } : {}),
      });
      const reader = handle.stream.getReader();
      let text = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const event = value as ArivieEvent;
        switch (event.type) {
          case "model.delta":
            input.onText?.(event.payload.text);
            break;
          case "tool.call.started":
            input.onTool?.(event.payload.tool, event.payload.args);
            break;
          case "run.completed":
            if (typeof event.payload.text === "string") text = event.payload.text;
            break;
          case "run.failed":
            throw new Error(event.payload.error.message);
          default:
            break;
        }
      }
      return text;
    },
    handler: async (req: Request) => hono.fetch(req),
    hono,
    async dispose() {
      // Release plugin-opened resources (e.g. analytics source pools) before
      // the runtime storage, so the process can exit cleanly.
      for (const dispose of manifest.disposers) {
        await dispose();
      }
      await config.storage.close?.();
    },
  };
}
