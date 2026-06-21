/* SPDX-License-Identifier: Apache-2.0 */
import type postgres from "postgres";

export const RUNTIME_STORAGE_TABLES = [
  "arivie_dispatch_attempts",
  "arivie_context_index",
  "arivie_context_documents",
  "arivie_events",
  "arivie_dispatch_messages",
  "arivie_leases",
  "arivie_runs",
  "arivie_sessions",
] as const;

export async function migrateRuntimeStorage(sql: postgres.Sql): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS arivie_sessions (
      id TEXT PRIMARY KEY,
      resource TEXT NOT NULL,
      user_id TEXT NOT NULL,
      agent_id TEXT,
      metadata JSONB,
      metadata_present BOOLEAN NOT NULL DEFAULT false,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS arivie_runs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES arivie_sessions(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL,
      status TEXT NOT NULL,
      input JSONB,
      input_present BOOLEAN NOT NULL DEFAULT false,
      result JSONB,
      result_present BOOLEAN NOT NULL DEFAULT false,
      error JSONB,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS arivie_runs_session_created_idx
    ON arivie_runs (session_id, created_at, id)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS arivie_events (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES arivie_runs(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL,
      seq BIGINT NOT NULL,
      cursor TEXT NOT NULL,
      type TEXT NOT NULL,
      payload JSONB NOT NULL,
      timestamp TEXT NOT NULL,
      UNIQUE (run_id, seq),
      UNIQUE (run_id, cursor)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS arivie_events_run_cursor_idx
    ON arivie_events (run_id, cursor)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS arivie_dispatch_messages (
      id TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      event JSONB NOT NULL,
      dedupe_key TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      available_at TEXT NOT NULL,
      claimed_by TEXT,
      claimed_until TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS arivie_dispatch_claim_idx
    ON arivie_dispatch_messages (status, available_at, claimed_until, created_at, id)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS arivie_dispatch_attempts (
      id BIGSERIAL PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES arivie_dispatch_messages(id) ON DELETE CASCADE,
      attempt_no INTEGER NOT NULL,
      error TEXT NOT NULL,
      at TEXT NOT NULL
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS arivie_dispatch_attempts_message_idx
    ON arivie_dispatch_attempts (message_id, attempt_no)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS arivie_leases (
      key TEXT PRIMARY KEY,
      holder TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS arivie_context_documents (
      id TEXT PRIMARY KEY,
      schema TEXT NOT NULL,
      text TEXT NOT NULL,
      metadata JSONB,
      metadata_present BOOLEAN NOT NULL DEFAULT false,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS arivie_context_index (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES arivie_context_documents(id) ON DELETE CASCADE,
      schema TEXT NOT NULL,
      text TEXT NOT NULL,
      metadata JSONB,
      metadata_present BOOLEAN NOT NULL DEFAULT false,
      updated_at TEXT NOT NULL
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS arivie_context_index_schema_idx
    ON arivie_context_index (schema, id)
  `;
}
