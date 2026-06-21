/* SPDX-License-Identifier: Apache-2.0 */
import type postgres from "postgres";
import { ToolError } from "./errors.js";
import { escapeIdent } from "./identifier.js";
import type { ExecuteResult } from "./types.js";

export interface ExecuteImplOptions {
  query: string;
  runAsRole?: string;
  userId: string;
  rowLimit: number;
  timeoutMs: number;
  params?: readonly unknown[];
  credentials?: unknown;
}

function isPostgresError(err: unknown): err is { code: string } {
  return typeof err === "object" && err !== null && "code" in err;
}

export async function executeImpl(
  sql: postgres.Sql,
  opts: ExecuteImplOptions,
): Promise<ExecuteResult> {
  const startedAt = Date.now();

  // [S0-fix r2-mR2-1] Defence-in-depth: validate timeoutMs at the boundary.
  // A non-positive or non-integer value would silently disable the statement
  // timeout in Postgres (0 means disabled). Reject explicitly.
  if (
    !Number.isFinite(opts.timeoutMs) ||
    !Number.isInteger(opts.timeoutMs) ||
    opts.timeoutMs <= 0
  ) {
    throw new ToolError(
      "sql-invalid",
      `timeoutMs must be a positive integer; got ${String(opts.timeoutMs)}`,
    );
  }
  if (
    !Number.isFinite(opts.rowLimit) ||
    !Number.isInteger(opts.rowLimit) ||
    opts.rowLimit <= 0
  ) {
    throw new ToolError(
      "sql-invalid",
      `rowLimit must be a positive integer; got ${String(opts.rowLimit)}`,
    );
  }
  // runAsRole is OPTIONAL. When provided, queries run under that least-
  // privilege DB role (SET LOCAL ROLE) — the DB-level read-only boundary. When
  // omitted (e.g. local dev), queries run as the connection role; the SELECT-
  // only SQL guard (validateExecuteSql) still blocks writes, so this is a
  // defense-in-depth relaxation, not a hole. Provide a role in production.
  const runAsRole =
    typeof opts.runAsRole === "string" && opts.runAsRole.length > 0
      ? opts.runAsRole
      : undefined;

  try {
    const rows = await sql.begin(async (tx) => {
      if (runAsRole !== undefined) {
        await tx.unsafe(`SET LOCAL ROLE ${escapeIdent(runAsRole)}`);
      }
      await tx.unsafe(
        `SET LOCAL statement_timeout = ${opts.timeoutMs}`,
      );
      // [S2-fix pi-N2] Validate params are primitives at the adapter
      // boundary, not just inside compileMetricFor. Defence-in-depth: any
      // future caller that bypasses compile_metric still hits this gate.
      let queryParams: (string | number | boolean | null)[] | undefined;
      if (opts.params != null) {
        const copy = [...opts.params];
        for (let i = 0; i < copy.length; i++) {
          const v = copy[i];
          if (
            v !== null &&
            typeof v !== "string" &&
            typeof v !== "number" &&
            typeof v !== "boolean"
          ) {
            throw new ToolError(
              "sql-invalid",
              `params[${i}] must be string|number|boolean|null; got ${typeof v}`,
            );
          }
        }
        queryParams = copy as (string | number | boolean | null)[];
      }
      return (await tx.unsafe(opts.query, queryParams)) as Record<
        string,
        unknown
      >[];
    });

    const truncated = rows.length > opts.rowLimit;
    const limited = rows.slice(0, opts.rowLimit);

    return {
      rows: limited,
      rowCount: limited.length,
      durationMs: Date.now() - startedAt,
      truncated,
    };
  } catch (err) {
    if (isPostgresError(err)) {
      if (err.code === "42501") {
        throw new ToolError(
          "sql-permission-denied",
          "permission denied for SQL operation",
        );
      }
      if (err.code === "57014") {
        throw new ToolError("sql-timeout", "statement timeout");
      }
    }
    throw err;
  }
}
