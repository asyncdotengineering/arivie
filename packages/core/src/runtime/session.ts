/* SPDX-License-Identifier: Apache-2.0 */
import { ArivieConfigError } from "../errors.js";
import type { EventInput } from "../storage/types.js";
import { executeRun } from "./run.js";
import { encodeContinuation, streamEvents } from "./stream.js";
import type {
  AgentDefinition,
  CreateRuntimeOptions,
  CreateSessionInput,
  ResolvedAgent,
  Runtime,
  SessionHandle,
} from "./types.js";

/** Validate and return an {@link AgentDefinition} (RFC §4.1). */
export function defineAgent(definition: AgentDefinition): AgentDefinition {
  if (
    typeof definition.instructions !== "string" ||
    definition.instructions.length === 0
  ) {
    throw new ArivieConfigError("Agent instructions must be a non-empty string");
  }
  return definition;
}

/**
 * Build the durable runtime engine (RFC §6.1-6.4). `sessions.create` admits a
 * run, persists session/run-started events, leases the run for single
 * execution, kicks off the executor in the background, and returns a
 * cursor-resumable event stream. Storage-backed and Mastra-agnostic: the
 * `executor` is the only seam where a model substrate plugs in.
 */
export function createRuntime(options: CreateRuntimeOptions): Runtime {
  const { storage, agents, executor } = options;
  const streamPollMs = options.streamPollMs ?? 25;
  const runLeaseTtlMs = options.runLeaseTtlMs ?? 300_000;

  function resolveAgent(id: string): ResolvedAgent {
    const definition = agents[id];
    if (definition === undefined) {
      throw new ArivieConfigError(`Unknown agent "${id}"`);
    }
    return { id, definition };
  }

  async function create(input: CreateSessionInput): Promise<SessionHandle> {
    const agent = resolveAgent(input.agent);
    if (input.user?.userId === undefined || input.user.userId.length === 0) {
      throw new ArivieConfigError("user.userId is required");
    }

    const resource = input.session?.resource ?? input.user.userId;
    const requestedId = input.session?.id;
    let session = requestedId
      ? await storage.sessions.get(requestedId)
      : undefined;
    const isNewSession = session === undefined;
    if (session === undefined) {
      session = await storage.sessions.create({
        ...(requestedId !== undefined ? { id: requestedId } : {}),
        resource,
        userId: input.user.userId,
        agentId: agent.id,
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      });
    }

    const run = await storage.runs.create({
      sessionId: session.id,
      agentId: agent.id,
      input: input.prompt ?? input.messages,
    });

    const emit = (event: EventInput) => storage.events.append(run.id, event);
    if (isNewSession) {
      await emit({
        type: "session.started",
        sessionId: session.id,
        payload: { agentId: agent.id, userId: input.user.userId, resource },
      });
    }
    await emit({
      type: "run.started",
      sessionId: session.id,
      payload: {
        agentId: agent.id,
        ...(input.prompt !== undefined ? { input: input.prompt } : {}),
      },
    });

    // Lease the run so only one worker executes it (the multi-replica guard
    // that C9's dispatch worker relies on). If unavailable, another worker
    // owns execution and we only stream.
    const lease = await storage.leases.acquire(`run:${run.id}`, {
      holder: run.id,
      ttlMs: runLeaseTtlMs,
    });
    if (lease !== null) {
      void executeRun({ storage, executor, run, session, agent, input, lease });
    }

    const latest = await storage.events.latestCursor(run.id);
    return {
      sessionId: session.id,
      runId: run.id,
      continuationToken: encodeContinuation(run.id, latest),
      stream: streamEvents(storage, run.id, undefined, streamPollMs),
    };
  }

  return {
    storage,
    agents,
    sessions: { create },
    events: {
      stream: (runId, cursor) =>
        streamEvents(storage, runId, cursor, streamPollMs),
      readAfter: (runId, cursor, limit) =>
        storage.events.readAfter(runId, cursor, limit),
    },
  };
}
