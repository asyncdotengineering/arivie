/* SPDX-License-Identifier: Apache-2.0 */
import type { ArivieEvent } from "../events/types.js";

/**
 * Durable runtime storage (RFC §4.8). One adapter provides every store the
 * runtime needs: sessions, runs, the replayable event log, the dispatch queue,
 * and leases (plus an optional context index). The in-memory store (dev) and
 * the Postgres store (C5) both implement this contract and pass the shared
 * suite in `./contract.ts`.
 */
export interface RuntimeStorage {
  sessions: SessionStore;
  runs: RunStore;
  events: EventStore;
  dispatch: DispatchQueueStore;
  leases: LeaseStore;
  context?: ContextIndexStore;
  close?(): Promise<void>;
}

// ── Sessions ────────────────────────────────────────────────────────────────

export interface SessionRecord {
  id: string;
  /** Memory resource owner (defaults to userId at the call site). */
  resource: string;
  userId: string;
  /** Default agent for the session, when pinned. */
  agentId?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSessionInput {
  id?: string;
  resource: string;
  userId: string;
  agentId?: string;
  metadata?: Record<string, unknown>;
}

export interface SessionStore {
  create(input: CreateSessionInput): Promise<SessionRecord>;
  get(id: string): Promise<SessionRecord | undefined>;
}

// ── Runs ─────────────────────────────────────────────────────────────────────

export type RunStatus = "queued" | "running" | "completed" | "failed";

export interface RunError {
  message: string;
  name?: string;
  code?: string;
}

export interface RunRecord {
  id: string;
  sessionId: string;
  agentId: string;
  status: RunStatus;
  input?: unknown;
  result?: unknown;
  error?: RunError;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRunInput {
  id?: string;
  sessionId: string;
  agentId: string;
  input?: unknown;
}

export interface RunStore {
  create(input: CreateRunInput): Promise<RunRecord>;
  get(id: string): Promise<RunRecord | undefined>;
  setStatus(id: string, status: RunStatus): Promise<RunRecord>;
  complete(id: string, result?: unknown): Promise<RunRecord>;
  fail(id: string, error: RunError): Promise<RunRecord>;
  listBySession(sessionId: string): Promise<RunRecord[]>;
}

// ── Events ───────────────────────────────────────────────────────────────────

/** Distributive Omit so the discriminated union keeps `type`↔`payload` paired. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

/**
 * An event as supplied to {@link EventStore.append}. The store owns `cursor`
 * assignment (monotonic per run) so replay/resume is deterministic and no two
 * concurrent appends collide; `id` and `timestamp` are filled if omitted.
 */
export type EventInput = DistributiveOmit<
  ArivieEvent,
  "cursor" | "id" | "timestamp" | "runId"
> & {
  id?: string;
  timestamp?: string;
};

export interface EventStore {
  /** Append an event, assigning the next cursor for its run. Returns the stored event. */
  append(runId: string, event: EventInput): Promise<ArivieEvent>;
  /**
   * Read events for a run strictly after `cursor` (undefined = from start),
   * in cursor order, up to `limit`. The basis of cursor replay (RFC §6.4).
   */
  readAfter(
    runId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<ArivieEvent[]>;
  /** Highest cursor stored for a run, or undefined if none. */
  latestCursor(runId: string): Promise<string | undefined>;
}

// ── Dispatch queue ───────────────────────────────────────────────────────────

export type DispatchStatus = "queued" | "claimed" | "completed" | "dead_letter";

export interface DispatchMessage {
  id: string;
  channel: string;
  /** The verified inbound event payload (channel-specific). */
  event: unknown;
  /** Dedupe key — delivery id or payload hash (RFC §6.5). */
  dedupeKey: string;
  status: DispatchStatus;
  attempts: number;
  /** Earliest time the message may be claimed (backoff). ISO timestamp. */
  availableAt: string;
  claimedBy?: string;
  claimedUntil?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AdmitDispatchInput {
  channel: string;
  event: unknown;
  dedupeKey: string;
  /** Injectable clock (epoch ms) for deterministic tests. Defaults to now. */
  now?: number;
}

export interface AdmitDispatchResult {
  message: DispatchMessage;
  /** True when an existing message already held this dedupe key (RFC §6.5). */
  duplicate: boolean;
}

export interface ClaimReadyInput {
  limit: number;
  leaseMs: number;
  workerId: string;
  /** Injectable clock (epoch ms) for deterministic tests. Defaults to now. */
  now?: number;
}

export interface RetryLaterInput {
  backoffMs: number;
  error: string;
  now?: number;
}

export interface DispatchQueueStore {
  /** Idempotently admit a message by dedupe key. */
  admit(input: AdmitDispatchInput): Promise<AdmitDispatchResult>;
  /**
   * Atomically claim up to `limit` ready messages (status queued, or claimed
   * with an expired lease, and availableAt ≤ now), marking them claimed under
   * `workerId` for `leaseMs`. Two concurrent workers MUST never claim the same
   * message (RFC §11 abort criterion).
   */
  claimReady(input: ClaimReadyInput): Promise<DispatchMessage[]>;
  complete(id: string): Promise<void>;
  retryLater(id: string, input: RetryLaterInput): Promise<void>;
  deadLetter(id: string, error: string): Promise<void>;
  get(id: string): Promise<DispatchMessage | undefined>;
}

// ── Leases ───────────────────────────────────────────────────────────────────

export interface Lease {
  key: string;
  holder: string;
  expiresAt: string;
}

export interface AcquireLeaseInput {
  holder: string;
  ttlMs: number;
  now?: number;
}

export interface LeaseStore {
  /** Acquire `key`, or return null if a live lease is held by someone else. */
  acquire(key: string, input: AcquireLeaseInput): Promise<Lease | null>;
  /** Release a held lease (no-op if already expired/replaced). */
  release(lease: Lease): Promise<void>;
}

// ── Context index (optional) ─────────────────────────────────────────────────

export interface ContextIndexRecord {
  id: string;
  schema: string;
  text: string;
  metadata?: Record<string, unknown>;
}

export interface ContextIndexStore {
  upsert(records: ContextIndexRecord[]): Promise<void>;
  get(id: string): Promise<ContextIndexRecord | undefined>;
  clear(): Promise<void>;
}
