/* SPDX-License-Identifier: Apache-2.0 */
import { randomUUID } from "node:crypto";
import { ArivieInternalError } from "@arivie/core";
import type {
  AcquireLeaseInput,
  AdmitDispatchInput,
  AdmitDispatchResult,
  ArivieEvent,
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
} from "@arivie/core";
import postgres from "postgres";
import { migrateRuntimeStorage } from "./migrations.js";

export interface PostgresRuntimeOptions {
  url: string;
  maxConnections?: number;
  idleTimeoutMs?: number;
}

type Sql = postgres.Sql;
type JsonValue = Parameters<Sql["json"]>[0];

interface SessionRow {
  id: string;
  resource: string;
  user_id: string;
  agent_id: string | null;
  metadata: unknown;
  metadata_present: boolean;
  created_at: string;
  updated_at: string;
}

interface RunRow {
  id: string;
  session_id: string;
  agent_id: string;
  status: RunStatus;
  input: unknown;
  input_present: boolean;
  result: unknown;
  result_present: boolean;
  error: RunError | null;
  created_at: string;
  updated_at: string;
}

interface EventRow {
  id: string;
  run_id: string;
  session_id: string;
  cursor: string;
  type: ArivieEvent["type"];
  payload: unknown;
  timestamp: string;
}

interface DispatchRow {
  id: string;
  channel: string;
  event: unknown;
  dedupe_key: string;
  status: DispatchMessage["status"];
  attempts: number;
  available_at: string;
  claimed_by: string | null;
  claimed_until: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

interface LeaseRow {
  key: string;
  holder: string;
  expires_at: string;
}

interface ContextRow {
  id: string;
  schema: string;
  text: string;
  metadata: unknown;
  metadata_present: boolean;
}

function nowIso(now?: number): string {
  return new Date(now ?? Date.now()).toISOString();
}

function formatCursor(seq: number): string {
  if (!Number.isInteger(seq) || seq < 0) {
    throw new RangeError(`cursor sequence must be a non-negative integer: ${seq}`);
  }
  return seq.toString().padStart(16, "0");
}

function json(sql: Sql, value: unknown): postgres.Parameter {
  return sql.json(value as JsonValue);
}

function mapSession(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    resource: row.resource,
    userId: row.user_id,
    ...(row.agent_id !== null ? { agentId: row.agent_id } : {}),
    ...(row.metadata_present
      ? { metadata: row.metadata as Record<string, unknown> }
      : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRun(row: RunRow): RunRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    agentId: row.agent_id,
    status: row.status,
    ...(row.input_present ? { input: row.input } : {}),
    ...(row.result_present ? { result: row.result } : {}),
    ...(row.error !== null ? { error: row.error } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEvent(row: EventRow): ArivieEvent {
  return {
    cursor: row.cursor,
    id: row.id,
    type: row.type,
    sessionId: row.session_id,
    runId: row.run_id,
    timestamp: row.timestamp,
    payload: row.payload,
  } as ArivieEvent;
}

function mapDispatch(row: DispatchRow): DispatchMessage {
  return {
    id: row.id,
    channel: row.channel,
    event: row.event,
    dedupeKey: row.dedupe_key,
    status: row.status,
    attempts: row.attempts,
    availableAt: row.available_at,
    ...(row.claimed_by !== null ? { claimedBy: row.claimed_by } : {}),
    ...(row.claimed_until !== null ? { claimedUntil: row.claimed_until } : {}),
    ...(row.last_error !== null ? { lastError: row.last_error } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapLease(row: LeaseRow): Lease {
  return {
    key: row.key,
    holder: row.holder,
    expiresAt: row.expires_at,
  };
}

function mapContext(row: ContextRow): ContextIndexRecord {
  return {
    id: row.id,
    schema: row.schema,
    text: row.text,
    ...(row.metadata_present
      ? { metadata: row.metadata as Record<string, unknown> }
      : {}),
  };
}

class PostgresSessionStore implements SessionStore {
  constructor(
    private readonly sql: Sql,
    private readonly ensureMigrated: () => Promise<void>,
  ) {}

  async create(input: CreateSessionRecordInput): Promise<SessionRecord> {
    await this.ensureMigrated();
    const id = input.id ?? randomUUID();
    const ts = nowIso();
    const inserted = await this.sql<SessionRow[]>`
      INSERT INTO arivie_sessions (
        id, resource, user_id, agent_id, metadata, metadata_present, created_at, updated_at
      )
      VALUES (
        ${id},
        ${input.resource},
        ${input.userId},
        ${input.agentId ?? null},
        ${input.metadata === undefined ? null : json(this.sql, input.metadata)},
        ${input.metadata !== undefined},
        ${ts},
        ${ts}
      )
      ON CONFLICT (id) DO NOTHING
      RETURNING *
    `;
    const row = inserted[0] ?? (await this.getRow(id));
    if (row === undefined) {
      throw new ArivieInternalError(`Session "${id}" not found after create`);
    }
    return mapSession(row);
  }

  async get(id: string): Promise<SessionRecord | undefined> {
    await this.ensureMigrated();
    const row = await this.getRow(id);
    return row === undefined ? undefined : mapSession(row);
  }

  private async getRow(id: string): Promise<SessionRow | undefined> {
    const rows = await this.sql<SessionRow[]>`
      SELECT * FROM arivie_sessions WHERE id = ${id}
    `;
    return rows[0];
  }
}

class PostgresRunStore implements RunStore {
  constructor(
    private readonly sql: Sql,
    private readonly ensureMigrated: () => Promise<void>,
  ) {}

  async create(input: CreateRunInput): Promise<RunRecord> {
    await this.ensureMigrated();
    const id = input.id ?? randomUUID();
    const ts = nowIso();
    const inserted = await this.sql<RunRow[]>`
      INSERT INTO arivie_runs (
        id, session_id, agent_id, status, input, input_present, created_at, updated_at
      )
      VALUES (
        ${id},
        ${input.sessionId},
        ${input.agentId},
        'queued',
        ${input.input === undefined ? null : json(this.sql, input.input)},
        ${input.input !== undefined},
        ${ts},
        ${ts}
      )
      ON CONFLICT (id) DO NOTHING
      RETURNING *
    `;
    const row = inserted[0] ?? (await this.getRow(id));
    if (row === undefined) {
      throw new ArivieInternalError(`Run "${id}" not found after create`);
    }
    return mapRun(row);
  }

  async get(id: string): Promise<RunRecord | undefined> {
    await this.ensureMigrated();
    const row = await this.getRow(id);
    return row === undefined ? undefined : mapRun(row);
  }

  async setStatus(id: string, status: RunStatus): Promise<RunRecord> {
    await this.ensureMigrated();
    return this.updateOne(
      id,
      this.sql<RunRow[]>`
        UPDATE arivie_runs
        SET status = ${status}, updated_at = ${nowIso()}
        WHERE id = ${id}
        RETURNING *
      `,
    );
  }

  async complete(id: string, result?: unknown): Promise<RunRecord> {
    await this.ensureMigrated();
    const hasResult = result !== undefined;
    return this.updateOne(
      id,
      this.sql<RunRow[]>`
        UPDATE arivie_runs
        SET
          status = 'completed',
          result = CASE WHEN ${hasResult} THEN ${hasResult ? json(this.sql, result) : null} ELSE result END,
          result_present = CASE WHEN ${hasResult} THEN true ELSE result_present END,
          updated_at = ${nowIso()}
        WHERE id = ${id}
        RETURNING *
      `,
    );
  }

  async fail(id: string, error: RunError): Promise<RunRecord> {
    await this.ensureMigrated();
    return this.updateOne(
      id,
      this.sql<RunRow[]>`
        UPDATE arivie_runs
        SET status = 'failed', error = ${json(this.sql, error)}, updated_at = ${nowIso()}
        WHERE id = ${id}
        RETURNING *
      `,
    );
  }

  async listBySession(sessionId: string): Promise<RunRecord[]> {
    await this.ensureMigrated();
    const rows = await this.sql<RunRow[]>`
      SELECT * FROM arivie_runs
      WHERE session_id = ${sessionId}
      ORDER BY created_at, id
    `;
    return rows.map(mapRun);
  }

  private async getRow(id: string): Promise<RunRow | undefined> {
    const rows = await this.sql<RunRow[]>`
      SELECT * FROM arivie_runs WHERE id = ${id}
    `;
    return rows[0];
  }

  private async updateOne(
    id: string,
    query: Promise<RunRow[]>,
  ): Promise<RunRecord> {
    const rows = await query;
    const row = rows[0];
    if (row === undefined) {
      throw new ArivieInternalError(`Run "${id}" not found`);
    }
    return mapRun(row);
  }
}

class PostgresEventStore implements EventStore {
  constructor(
    private readonly sql: Sql,
    private readonly ensureMigrated: () => Promise<void>,
  ) {}

  async append(runId: string, event: EventInput): Promise<ArivieEvent> {
    await this.ensureMigrated();
    return this.sql.begin(async (tx) => {
      await tx`LOCK TABLE arivie_events IN SHARE ROW EXCLUSIVE MODE`;
      const seqRows = await tx<{ next_seq: string | number }[]>`
        SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq
        FROM arivie_events
        WHERE run_id = ${runId}
      `;
      const seq = Number(seqRows[0]?.next_seq ?? 1);
      const cursor = formatCursor(seq);
      const rows = await tx<EventRow[]>`
        INSERT INTO arivie_events (
          id, run_id, session_id, seq, cursor, type, payload, timestamp
        )
        VALUES (
          ${event.id ?? randomUUID()},
          ${runId},
          ${event.sessionId},
          ${seq},
          ${cursor},
          ${event.type},
          ${json(this.sql, event.payload)},
          ${event.timestamp ?? nowIso()}
        )
        RETURNING id, run_id, session_id, cursor, type, payload, timestamp
      `;
      const row = rows[0];
      if (row === undefined) {
        throw new ArivieInternalError(`Event append for run "${runId}" returned no row`);
      }
      return mapEvent(row);
    });
  }

  async readAfter(
    runId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<ArivieEvent[]> {
    await this.ensureMigrated();
    const rows = await this.sql<EventRow[]>`
      SELECT id, run_id, session_id, cursor, type, payload, timestamp
      FROM arivie_events
      WHERE run_id = ${runId}
        AND (${cursor ?? ""} = '' OR cursor > ${cursor ?? ""})
      ORDER BY cursor
      LIMIT ${limit}
    `;
    return rows.map(mapEvent);
  }

  async latestCursor(runId: string): Promise<string | undefined> {
    await this.ensureMigrated();
    const rows = await this.sql<{ cursor: string }[]>`
      SELECT cursor
      FROM arivie_events
      WHERE run_id = ${runId}
      ORDER BY cursor DESC
      LIMIT 1
    `;
    return rows[0]?.cursor;
  }
}

class PostgresDispatchStore implements DispatchQueueStore {
  constructor(
    private readonly sql: Sql,
    private readonly ensureMigrated: () => Promise<void>,
  ) {}

  async admit(input: AdmitDispatchInput): Promise<AdmitDispatchResult> {
    await this.ensureMigrated();
    const ts = nowIso(input.now);
    const inserted = await this.sql<DispatchRow[]>`
      INSERT INTO arivie_dispatch_messages (
        id, channel, event, dedupe_key, status, attempts, available_at, created_at, updated_at
      )
      VALUES (
        ${randomUUID()},
        ${input.channel},
        ${json(this.sql, input.event)},
        ${input.dedupeKey},
        'queued',
        0,
        ${ts},
        ${ts},
        ${ts}
      )
      ON CONFLICT (dedupe_key) DO NOTHING
      RETURNING *
    `;
    const insertedRow = inserted[0];
    if (insertedRow !== undefined) {
      return { message: mapDispatch(insertedRow), duplicate: false };
    }
    const existing = await this.sql<DispatchRow[]>`
      SELECT * FROM arivie_dispatch_messages WHERE dedupe_key = ${input.dedupeKey}
    `;
    const row = existing[0];
    if (row === undefined) {
      throw new ArivieInternalError(
        `Dispatch message with dedupe key "${input.dedupeKey}" not found after conflict`,
      );
    }
    return { message: mapDispatch(row), duplicate: true };
  }

  async claimReady(input: ClaimReadyInput): Promise<DispatchMessage[]> {
    await this.ensureMigrated();
    if (input.limit <= 0) return [];
    const now = input.now ?? Date.now();
    const ts = nowIso(now);
    const claimedUntil = nowIso(now + input.leaseMs);
    const rows = await this.sql<DispatchRow[]>`
      WITH picked AS (
        SELECT id
        FROM arivie_dispatch_messages
        WHERE available_at <= ${ts}
          AND (
            status = 'queued'
            OR (status = 'claimed' AND claimed_until IS NOT NULL AND claimed_until <= ${ts})
          )
        ORDER BY created_at, id
        LIMIT ${input.limit}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE arivie_dispatch_messages AS message
      SET
        status = 'claimed',
        claimed_by = ${input.workerId},
        claimed_until = ${claimedUntil},
        updated_at = ${ts}
      FROM picked
      WHERE message.id = picked.id
      RETURNING message.*
    `;
    return rows.map(mapDispatch);
  }

  async complete(id: string): Promise<void> {
    await this.ensureMigrated();
    const rows = await this.sql<{ id: string }[]>`
      UPDATE arivie_dispatch_messages
      SET
        status = 'completed',
        claimed_by = NULL,
        claimed_until = NULL,
        updated_at = ${nowIso()}
      WHERE id = ${id}
      RETURNING id
    `;
    if (rows[0] === undefined) {
      throw new ArivieInternalError(`Dispatch message "${id}" not found`);
    }
  }

  async retryLater(id: string, input: RetryLaterInput): Promise<void> {
    await this.ensureMigrated();
    await this.sql.begin(async (tx) => {
      const locked = await tx<{ attempts: number }[]>`
        SELECT attempts
        FROM arivie_dispatch_messages
        WHERE id = ${id}
        FOR UPDATE
      `;
      const row = locked[0];
      if (row === undefined) {
        throw new ArivieInternalError(`Dispatch message "${id}" not found`);
      }
      const attemptNo = row.attempts + 1;
      const now = input.now ?? Date.now();
      const ts = nowIso(now);
      await tx`
        INSERT INTO arivie_dispatch_attempts (message_id, attempt_no, error, at)
        VALUES (${id}, ${attemptNo}, ${input.error}, ${ts})
      `;
      await tx`
        UPDATE arivie_dispatch_messages
        SET
          status = 'queued',
          attempts = attempts + 1,
          available_at = ${nowIso(now + input.backoffMs)},
          claimed_by = NULL,
          claimed_until = NULL,
          last_error = ${input.error},
          updated_at = ${ts}
        WHERE id = ${id}
      `;
    });
  }

  async deadLetter(id: string, error: string): Promise<void> {
    await this.ensureMigrated();
    await this.sql.begin(async (tx) => {
      const locked = await tx<{ attempts: number }[]>`
        SELECT attempts
        FROM arivie_dispatch_messages
        WHERE id = ${id}
        FOR UPDATE
      `;
      const row = locked[0];
      if (row === undefined) {
        throw new ArivieInternalError(`Dispatch message "${id}" not found`);
      }
      await tx`
        INSERT INTO arivie_dispatch_attempts (message_id, attempt_no, error, at)
        VALUES (${id}, ${row.attempts + 1}, ${error}, ${nowIso()})
      `;
      await tx`
        UPDATE arivie_dispatch_messages
        SET
          status = 'dead_letter',
          claimed_by = NULL,
          claimed_until = NULL,
          last_error = ${error},
          updated_at = ${nowIso()}
        WHERE id = ${id}
      `;
    });
  }

  async get(id: string): Promise<DispatchMessage | undefined> {
    await this.ensureMigrated();
    const rows = await this.sql<DispatchRow[]>`
      SELECT * FROM arivie_dispatch_messages WHERE id = ${id}
    `;
    const row = rows[0];
    return row === undefined ? undefined : mapDispatch(row);
  }
}

class PostgresLeaseStore implements LeaseStore {
  constructor(
    private readonly sql: Sql,
    private readonly ensureMigrated: () => Promise<void>,
  ) {}

  async acquire(key: string, input: AcquireLeaseInput): Promise<Lease | null> {
    await this.ensureMigrated();
    const now = input.now ?? Date.now();
    const ts = nowIso(now);
    const expiresAt = nowIso(now + input.ttlMs);
    const rows = await this.sql<LeaseRow[]>`
      INSERT INTO arivie_leases (key, holder, expires_at, updated_at)
      VALUES (${key}, ${input.holder}, ${expiresAt}, ${ts})
      ON CONFLICT (key) DO UPDATE
      SET holder = EXCLUDED.holder,
          expires_at = EXCLUDED.expires_at,
          updated_at = EXCLUDED.updated_at
      WHERE arivie_leases.holder = EXCLUDED.holder
         OR arivie_leases.expires_at <= ${ts}
      RETURNING key, holder, expires_at
    `;
    const row = rows[0];
    return row === undefined ? null : mapLease(row);
  }

  async release(lease: Lease): Promise<void> {
    await this.ensureMigrated();
    await this.sql`
      DELETE FROM arivie_leases
      WHERE key = ${lease.key}
        AND holder = ${lease.holder}
        AND expires_at = ${lease.expiresAt}
    `;
  }
}

class PostgresContextIndexStore implements ContextIndexStore {
  constructor(
    private readonly sql: Sql,
    private readonly ensureMigrated: () => Promise<void>,
  ) {}

  async upsert(records: ContextIndexRecord[]): Promise<void> {
    await this.ensureMigrated();
    if (records.length === 0) return;
    const ts = nowIso();
    await this.sql.begin(async (tx) => {
      for (const record of records) {
        const metadata = record.metadata === undefined
          ? null
          : json(this.sql, record.metadata);
        const metadataPresent = record.metadata !== undefined;
        await tx`
          INSERT INTO arivie_context_documents (
            id, schema, text, metadata, metadata_present, created_at, updated_at
          )
          VALUES (
            ${record.id},
            ${record.schema},
            ${record.text},
            ${metadata},
            ${metadataPresent},
            ${ts},
            ${ts}
          )
          ON CONFLICT (id) DO UPDATE
          SET schema = EXCLUDED.schema,
              text = EXCLUDED.text,
              metadata = EXCLUDED.metadata,
              metadata_present = EXCLUDED.metadata_present,
              updated_at = EXCLUDED.updated_at
        `;
        await tx`
          INSERT INTO arivie_context_index (
            id, document_id, schema, text, metadata, metadata_present, updated_at
          )
          VALUES (
            ${record.id},
            ${record.id},
            ${record.schema},
            ${record.text},
            ${metadata},
            ${metadataPresent},
            ${ts}
          )
          ON CONFLICT (id) DO UPDATE
          SET document_id = EXCLUDED.document_id,
              schema = EXCLUDED.schema,
              text = EXCLUDED.text,
              metadata = EXCLUDED.metadata,
              metadata_present = EXCLUDED.metadata_present,
              updated_at = EXCLUDED.updated_at
        `;
      }
    });
  }

  async get(id: string): Promise<ContextIndexRecord | undefined> {
    await this.ensureMigrated();
    const rows = await this.sql<ContextRow[]>`
      SELECT id, schema, text, metadata, metadata_present
      FROM arivie_context_documents
      WHERE id = ${id}
    `;
    const row = rows[0];
    return row === undefined ? undefined : mapContext(row);
  }

  async clear(): Promise<void> {
    await this.ensureMigrated();
    await this.sql`TRUNCATE arivie_context_index, arivie_context_documents`;
  }
}

class PostgresRuntimeStorage implements RuntimeStorage {
  readonly sessions: SessionStore;
  readonly runs: RunStore;
  readonly events: EventStore;
  readonly dispatch: DispatchQueueStore;
  readonly leases: LeaseStore;
  readonly context: ContextIndexStore;
  private migrationPromise: Promise<void> | undefined;

  constructor(private readonly sql: Sql) {
    const ensureMigrated = () => this.ensureMigrated();
    this.sessions = new PostgresSessionStore(sql, ensureMigrated);
    this.runs = new PostgresRunStore(sql, ensureMigrated);
    this.events = new PostgresEventStore(sql, ensureMigrated);
    this.dispatch = new PostgresDispatchStore(sql, ensureMigrated);
    this.leases = new PostgresLeaseStore(sql, ensureMigrated);
    this.context = new PostgresContextIndexStore(sql, ensureMigrated);
  }

  async close(): Promise<void> {
    await this.sql.end();
  }

  private ensureMigrated(): Promise<void> {
    this.migrationPromise ??= migrateRuntimeStorage(this.sql);
    return this.migrationPromise;
  }
}

export function postgresRuntime(options: PostgresRuntimeOptions): RuntimeStorage {
  const sql = postgres(options.url, {
    max: options.maxConnections ?? 10,
    idle_timeout: (options.idleTimeoutMs ?? 30_000) / 1000,
    onnotice: () => {},
  });
  return new PostgresRuntimeStorage(sql);
}
