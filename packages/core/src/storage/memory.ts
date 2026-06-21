/* SPDX-License-Identifier: Apache-2.0 */
import { randomUUID } from "node:crypto";
import { ArivieInternalError } from "../errors.js";
import { compareCursors, formatCursor } from "../events/encode.js";
import type { ArivieEvent } from "../events/types.js";
import type {
  AcquireLeaseInput,
  AdmitDispatchInput,
  AdmitDispatchResult,
  ClaimReadyInput,
  ContextIndexRecord,
  ContextIndexStore,
  CreateRunInput,
  CreateSessionRecordInput,
  DispatchMessage,
  DispatchQueueStore,
  EventInput,
  EventStore,
  Lease,
  LeaseStore,
  RetryLaterInput,
  RunError,
  RunRecord,
  RunStatus,
  RunStore,
  RuntimeStorage,
  SessionRecord,
  SessionStore,
} from "./types.js";

function nowIso(now?: number): string {
  return new Date(now ?? Date.now()).toISOString();
}

class MemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, SessionRecord>();

  async create(input: CreateSessionRecordInput): Promise<SessionRecord> {
    const id = input.id ?? randomUUID();
    const existing = this.sessions.get(id);
    if (existing !== undefined) return existing;
    const ts = nowIso();
    const record: SessionRecord = {
      id,
      resource: input.resource,
      userId: input.userId,
      ...(input.agentId !== undefined ? { agentId: input.agentId } : {}),
      ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      createdAt: ts,
      updatedAt: ts,
    };
    this.sessions.set(id, record);
    return record;
  }

  async get(id: string): Promise<SessionRecord | undefined> {
    return this.sessions.get(id);
  }
}

class MemoryRunStore implements RunStore {
  private readonly runs = new Map<string, RunRecord>();

  async create(input: CreateRunInput): Promise<RunRecord> {
    const id = input.id ?? randomUUID();
    const ts = nowIso();
    const record: RunRecord = {
      id,
      sessionId: input.sessionId,
      agentId: input.agentId,
      status: "queued",
      ...(input.input !== undefined ? { input: input.input } : {}),
      createdAt: ts,
      updatedAt: ts,
    };
    this.runs.set(id, record);
    return record;
  }

  async get(id: string): Promise<RunRecord | undefined> {
    return this.runs.get(id);
  }

  private require(id: string): RunRecord {
    const run = this.runs.get(id);
    if (run === undefined) {
      throw new ArivieInternalError(`Run "${id}" not found`);
    }
    return run;
  }

  async setStatus(id: string, status: RunStatus): Promise<RunRecord> {
    const run = this.require(id);
    const updated: RunRecord = { ...run, status, updatedAt: nowIso() };
    this.runs.set(id, updated);
    return updated;
  }

  async complete(id: string, result?: unknown): Promise<RunRecord> {
    const run = this.require(id);
    const updated: RunRecord = {
      ...run,
      status: "completed",
      ...(result !== undefined ? { result } : {}),
      updatedAt: nowIso(),
    };
    this.runs.set(id, updated);
    return updated;
  }

  async fail(id: string, error: RunError): Promise<RunRecord> {
    const run = this.require(id);
    const updated: RunRecord = {
      ...run,
      status: "failed",
      error,
      updatedAt: nowIso(),
    };
    this.runs.set(id, updated);
    return updated;
  }

  async listBySession(sessionId: string): Promise<RunRecord[]> {
    return [...this.runs.values()]
      .filter((r) => r.sessionId === sessionId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
}

class MemoryEventStore implements EventStore {
  /** runId → ordered event list. Sequence is per-run, starting at 1. */
  private readonly byRun = new Map<string, ArivieEvent[]>();

  async append(runId: string, event: EventInput): Promise<ArivieEvent> {
    const list = this.byRun.get(runId) ?? [];
    const seq = list.length + 1;
    const stored = {
      ...event,
      runId,
      cursor: formatCursor(seq),
      id: event.id ?? randomUUID(),
      timestamp: event.timestamp ?? nowIso(),
    } as ArivieEvent;
    list.push(stored);
    this.byRun.set(runId, list);
    return stored;
  }

  async readAfter(
    runId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<ArivieEvent[]> {
    const list = this.byRun.get(runId) ?? [];
    const after = cursor ?? "";
    return list
      .filter((e) => after === "" || compareCursors(e.cursor, after) > 0)
      .slice(0, limit);
  }

  async latestCursor(runId: string): Promise<string | undefined> {
    const list = this.byRun.get(runId);
    return list !== undefined && list.length > 0
      ? list[list.length - 1]!.cursor
      : undefined;
  }
}

class MemoryDispatchStore implements DispatchQueueStore {
  private readonly messages = new Map<string, DispatchMessage>();
  /** dedupeKey → message id, enforcing single admission (RFC §6.5). */
  private readonly byDedupe = new Map<string, string>();

  async admit(input: AdmitDispatchInput): Promise<AdmitDispatchResult> {
    const existingId = this.byDedupe.get(input.dedupeKey);
    if (existingId !== undefined) {
      return { message: this.messages.get(existingId)!, duplicate: true };
    }
    const ts = nowIso(input.now);
    const message: DispatchMessage = {
      id: randomUUID(),
      channel: input.channel,
      event: input.event,
      dedupeKey: input.dedupeKey,
      status: "queued",
      attempts: 0,
      availableAt: ts,
      createdAt: ts,
      updatedAt: ts,
    };
    this.messages.set(message.id, message);
    this.byDedupe.set(message.dedupeKey, message.id);
    return { message, duplicate: false };
  }

  // No `await` between read and write: the claim is atomic on the single-
  // threaded event loop, so two concurrent claimReady calls cannot grab the
  // same message (the in-memory analogue of Postgres row locking in C5).
  async claimReady(input: ClaimReadyInput): Promise<DispatchMessage[]> {
    const now = input.now ?? Date.now();
    const nowMs = now;
    const claimed: DispatchMessage[] = [];
    for (const message of this.messages.values()) {
      if (claimed.length >= input.limit) break;
      const available = Date.parse(message.availableAt) <= nowMs;
      const leaseExpired =
        message.claimedUntil === undefined ||
        Date.parse(message.claimedUntil) <= nowMs;
      const claimable =
        (message.status === "queued" ||
          (message.status === "claimed" && leaseExpired)) &&
        available;
      if (!claimable) continue;
      const updated: DispatchMessage = {
        ...message,
        status: "claimed",
        claimedBy: input.workerId,
        claimedUntil: new Date(nowMs + input.leaseMs).toISOString(),
        updatedAt: new Date(nowMs).toISOString(),
      };
      this.messages.set(message.id, updated);
      claimed.push(updated);
    }
    return claimed;
  }

  private require(id: string): DispatchMessage {
    const message = this.messages.get(id);
    if (message === undefined) {
      throw new ArivieInternalError(`Dispatch message "${id}" not found`);
    }
    return message;
  }

  async complete(id: string): Promise<void> {
    const message = this.require(id);
    this.messages.set(id, {
      ...message,
      status: "completed",
      claimedBy: undefined,
      claimedUntil: undefined,
      updatedAt: nowIso(),
    });
  }

  async retryLater(id: string, input: RetryLaterInput): Promise<void> {
    const message = this.require(id);
    const now = input.now ?? Date.now();
    this.messages.set(id, {
      ...message,
      status: "queued",
      attempts: message.attempts + 1,
      availableAt: new Date(now + input.backoffMs).toISOString(),
      lastError: input.error,
      claimedBy: undefined,
      claimedUntil: undefined,
      updatedAt: new Date(now).toISOString(),
    });
  }

  async deadLetter(id: string, error: string): Promise<void> {
    const message = this.require(id);
    this.messages.set(id, {
      ...message,
      status: "dead_letter",
      lastError: error,
      claimedBy: undefined,
      claimedUntil: undefined,
      updatedAt: nowIso(),
    });
  }

  async get(id: string): Promise<DispatchMessage | undefined> {
    return this.messages.get(id);
  }
}

class MemoryLeaseStore implements LeaseStore {
  private readonly leases = new Map<string, Lease>();

  async acquire(key: string, input: AcquireLeaseInput): Promise<Lease | null> {
    const now = input.now ?? Date.now();
    const existing = this.leases.get(key);
    if (
      existing !== undefined &&
      existing.holder !== input.holder &&
      Date.parse(existing.expiresAt) > now
    ) {
      return null;
    }
    const lease: Lease = {
      key,
      holder: input.holder,
      expiresAt: new Date(now + input.ttlMs).toISOString(),
    };
    this.leases.set(key, lease);
    return lease;
  }

  async release(lease: Lease): Promise<void> {
    const existing = this.leases.get(lease.key);
    if (existing !== undefined && existing.holder === lease.holder) {
      this.leases.delete(lease.key);
    }
  }
}

class MemoryContextIndexStore implements ContextIndexStore {
  private readonly records = new Map<string, ContextIndexRecord>();

  async upsert(records: ContextIndexRecord[]): Promise<void> {
    for (const record of records) this.records.set(record.id, record);
  }

  async get(id: string): Promise<ContextIndexRecord | undefined> {
    return this.records.get(id);
  }

  async clear(): Promise<void> {
    this.records.clear();
  }
}

/**
 * In-memory runtime storage for local development and tests (RFC §12 Q8).
 * Implements the same {@link RuntimeStorage} contract as the Postgres store
 * (C5); both pass the shared suite in `./contract.ts`. Not durable across
 * process restarts — production templates use Postgres.
 */
export class InMemoryRuntimeStorage implements RuntimeStorage {
  readonly sessions: SessionStore = new MemorySessionStore();
  readonly runs: RunStore = new MemoryRunStore();
  readonly events: EventStore = new MemoryEventStore();
  readonly dispatch: DispatchQueueStore = new MemoryDispatchStore();
  readonly leases: LeaseStore = new MemoryLeaseStore();
  readonly context: ContextIndexStore = new MemoryContextIndexStore();

  async close(): Promise<void> {
    // Nothing to release for the in-memory store.
  }
}
