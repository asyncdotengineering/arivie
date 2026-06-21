/* SPDX-License-Identifier: Apache-2.0 */
import { Agent } from "@mastra/core/agent";
import { InMemoryStore } from "@mastra/core/storage";
import { Memory } from "@mastra/memory";
import type { Hono } from "hono";
import type { LanguageModel } from "ai";
import { assertManifestValid } from "./manifest/validate.js";
import { buildManifest } from "./manifest/build.js";
import type { RuntimeManifest } from "./manifest/types.js";
import type { PluginInstance } from "./plugins/types.js";
import { assembleAgentContext } from "./runtime/assemble.js";
import { createMastraExecutor } from "./runtime/mastra-executor.js";
import { createRuntime } from "./runtime/session.js";
import type { AgentDefinition, Runtime, UserContext } from "./runtime/types.js";
import { createSessionApp } from "./server/routes/session.js";
import type { RuntimeStorage } from "./storage/types.js";

/**
 * Domain-neutral app configuration (RFC §4.1). No analytics-specific keys —
 * analytics is composed in as a plugin. This is the new `defineArivie` shape;
 * during the migration it is exported as `defineApp` so the legacy analytics
 * `defineArivie` keeps working until the cut completes.
 */
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
  context?: { root: string };
  resolveUser: (req: Request) => Promise<UserContext> | UserContext;
  /**
   * Mastra storage backing agent conversation Memory. The runtime Session is
   * used as the Mastra thread, so multi-turn history persists through Mastra's
   * own Memory primitive. Defaults to an in-memory store (dev); pass a
   * `PostgresStore` (from `@mastra/pg`) for production durability.
   */
  memory?: MemoryStorage;
}

export interface ArivieApp {
  app: { id: string; name: string };
  manifest: RuntimeManifest;
  runtime: Runtime;
  sessions: Runtime["sessions"];
  events: Runtime["events"];
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
): Agent {
  const { instructions, tools } = assembleAgentContext(agentId, agent, manifest);
  return new Agent({
    id: agentId,
    name: agentId,
    model: (agent.model ?? model) as ConstructorParameters<typeof Agent>[0]["model"],
    instructions,
    tools: tools as NonNullable<ConstructorParameters<typeof Agent>[0]["tools"]>,
    memory: new Memory({ storage: memoryStorage }),
  });
}

/**
 * Build a domain-neutral Arivie app (RFC §4.1, §6.1). Compiles the plugin
 * manifest, builds one Mastra agent per `agents` entry (each scoped to the
 * tools + instruction fragments of the plugins backing its capabilities),
 * wires the Mastra executor into the durable runtime, and exposes the session
 * API + HTTP handler. Analytics, when present, is just one plugin.
 */
export async function defineApp(config: ArivieAppConfig): Promise<ArivieApp> {
  const appMeta = { id: config.app.id, name: config.app.name };
  const { manifest, diagnostics } = await buildManifest({
    app: appMeta,
    plugins: config.plugins ?? [],
  });
  assertManifestValid(diagnostics);

  const memoryStorage = config.memory ?? new InMemoryStore();
  const mastraAgents: Record<string, Agent> = {};
  for (const [id, agentDef] of Object.entries(config.agents)) {
    mastraAgents[id] = buildMastraAgent(
      id,
      agentDef,
      manifest,
      config.model,
      memoryStorage,
    );
  }

  const executor = createMastraExecutor({ agents: mastraAgents });
  const runtime = createRuntime({
    storage: config.storage,
    agents: config.agents,
    executor,
  });

  const hono = createSessionApp({ runtime, resolveUser: config.resolveUser });

  return {
    app: appMeta,
    manifest,
    runtime,
    sessions: runtime.sessions,
    events: runtime.events,
    handler: async (req: Request) => hono.fetch(req),
    hono,
    async dispose() {
      await config.storage.close?.();
    },
  };
}
