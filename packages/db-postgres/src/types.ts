/* SPDX-License-Identifier: Apache-2.0 */
import type {
  SourceAdapterCompileMetricOpts,
  SourceAdapterCompileMetricResult,
  SourceAdapterExecuteOpts,
} from "@arivie/core/types";
import type postgres from "postgres";

export interface PostgresAdapterOptions {
  url: string;
  readOnlyRole?: string;
  allowedSchemas?: string[];
  maxConnections?: number;
  idleTimeoutMs?: number;
}

export interface PostgresAdapter {
  readonly kind: "postgres";
  readonly id: string;
  /** Connection URL used to construct the underlying client (for Mastra PostgresStore). */
  readonly url: string;
  sql: postgres.Sql;
  execute(opts: SourceAdapterExecuteOpts<string>): Promise<ExecuteResult>;
  introspect(): Promise<TableMetadata[]>;
  verifyOwnerIdentity(expectedOwnerId: string): Promise<void>;
  setupRole(
    role: string,
    options?: { allowedTables?: string[] },
  ): Promise<void>;
  compileMetric?(
    opts: SourceAdapterCompileMetricOpts,
  ): SourceAdapterCompileMetricResult<string>;
  close?(): Promise<void>;
}

export interface ExecuteResult {
  rows: Record<string, unknown>[];
  rowCount: number;
  durationMs: number;
  truncated: boolean;
}

export interface TableMetadata {
  schema: string;
  name: string;
  columns: {
    name: string;
    type: string;
    nullable: boolean;
    comment?: string;
    isPii?: boolean;
  }[];
  primary_key: string[];
  foreign_keys: {
    column: string;
    references: { table: string; column: string };
  }[];
  row_count: number;
}
