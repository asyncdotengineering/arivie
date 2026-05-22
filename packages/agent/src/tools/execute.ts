/* SPDX-License-Identifier: Apache-2.0 */
import { getCurrentUserContext } from "@arivie/core/context";
import type { LifecycleHooks, LimitConfig } from "@arivie/core/types";
import { validateExecuteSql } from "@arivie/db-postgres";
import type { PostgresAdapter } from "@arivie/db-postgres";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

export interface ExecuteToolForOptions {
  readonly db: PostgresAdapter;
  readonly ownerId: string;
  readonly sourceName: string;
  readonly limits: LimitConfig;
  readonly hooks?: LifecycleHooks;
  readonly toolId?: string;
}

export function executeToolFor({
  db,
  ownerId,
  sourceName,
  limits,
  hooks,
  toolId = "execute",
}: ExecuteToolForOptions) {
  const rowLimit = limits.rowsPerQuery ?? 50;
  const timeoutMs = limits.queryTimeoutMs ?? 30_000;

  return createTool({
    id: toolId,
    description: `Run a read-only SQL query against the owner's database.
      The query MUST be a SELECT or WITH ... SELECT statement.
      Results are limited to ${rowLimit} rows; queries time out after ${timeoutMs}ms.`,
    inputSchema: z.object({
      sql: z.string().describe("A SELECT or WITH SQL query"),
    }),
    execute: async ({ sql }) => {
      const trimmed = sql.trim();
      // [S1-fix-2 KI-1-05] Hardened SQL guard: rejects multi-statement (`;`)
      // outside literals and CTE-DML bypasses (`WITH x AS (DELETE …) SELECT *`)
      // that the previous prefix-only regex accepted. See @arivie/db-postgres's
      // sql-guard.ts for the state-machine token scanner.
      validateExecuteSql(trimmed);

      const user = getCurrentUserContext();
      if (user == null) {
        throw new Error("no user context — auth resolver did not run");
      }

      await hooks?.onBeforeQuery?.({
        sql: trimmed,
        userId: user.userId,
        ownerId,
      });

      const credentials = user.credentials?.[sourceName];
      const result = await db.execute({
        query: trimmed,
        runAsRole: user.dbRole,
        userId: user.userId,
        rowLimit,
        timeoutMs,
        ...(credentials !== undefined ? { credentials } : {}),
      });

      await hooks?.onAfterQuery?.({
        sql: trimmed,
        rows: result.rows,
        durationMs: result.durationMs,
        userId: user.userId,
        ownerId,
      });

      return {
        rows: result.rows,
        rowCount: result.rowCount,
        truncated: result.truncated,
      };
    },
  });
}
