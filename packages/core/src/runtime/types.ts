/* SPDX-License-Identifier: Apache-2.0 */
import type { ArivieEvent } from "../events/types.js";
import type {
  EventInput,
  RunRecord,
  RuntimeStorage,
  SessionRecord,
} from "../storage/types.js";

/**
 * A named agent in the app (RFC §4.1). Domain-neutral: instructions plus the
 * capability ids it may use. Model resolution and tool wiring are the
 * executor's job (C7b wires Mastra), keeping this runtime substrate-agnostic.
 */
export interface AgentDefinition {
  instructions: string;
  capabilities?: string[];
  /** Optional per-agent model override; interpreted by the executor. */
  model?: unknown;
}

/** Identity for a turn (resolved by the host; see RFC §4.6). */
export interface UserContext {
  userId: string;
  permissions?: string[];
  dbRole?: string;
  raw?: unknown;
}

export interface CreateSessionInput {
  agent: string;
  prompt?: string;
  messages?: unknown[];
  session?: { id?: string; resource?: string };
  user: UserContext;
  metadata?: Record<string, unknown>;
}

export interface ResolvedAgent {
  id: string;
  definition: AgentDefinition;
}

/**
 * Handle returned by `sessions.create` (RFC §4.6): durable ids plus a
 * cursor-resumable event stream. `continuationToken` encodes (runId, cursor)
 * so a client can resume from where it left off.
 */
export interface SessionHandle {
  sessionId: string;
  runId: string;
  continuationToken: string;
  stream: ReadableStream<ArivieEvent>;
}

/**
 * Context handed to the {@link AgentExecutor} for one run. `emit` appends a
 * structured event (cursor assigned by storage). The executor is the single
 * seam where a model substrate (Mastra) plugs in — the engine itself never
 * imports Mastra.
 */
export interface RunContext {
  run: RunRecord;
  session: SessionRecord;
  agent: ResolvedAgent;
  input: CreateSessionInput;
  emit(event: EventInput): Promise<ArivieEvent>;
  signal: AbortSignal;
}

export interface AgentTurnResult {
  text?: string;
}

/** Drives one agent turn, emitting structured events. Returns the terminal result. */
export type AgentExecutor = (ctx: RunContext) => Promise<AgentTurnResult>;

export interface Runtime {
  storage: RuntimeStorage;
  agents: Record<string, AgentDefinition>;
  sessions: {
    create(input: CreateSessionInput): Promise<SessionHandle>;
  };
  events: {
    stream(runId: string, cursor?: string): ReadableStream<ArivieEvent>;
    readAfter(
      runId: string,
      cursor: string | undefined,
      limit: number,
    ): Promise<ArivieEvent[]>;
  };
}

export interface CreateRuntimeOptions {
  storage: RuntimeStorage;
  agents: Record<string, AgentDefinition>;
  executor: AgentExecutor;
  /** Event-stream poll interval in ms (default 25). */
  streamPollMs?: number;
  /** Run lease TTL in ms (default 300000). */
  runLeaseTtlMs?: number;
}
