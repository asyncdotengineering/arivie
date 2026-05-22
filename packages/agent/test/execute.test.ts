/* SPDX-License-Identifier: Apache-2.0 */
import { runWithUserContext } from "@arivie/core/context";
import { ToolError } from "@arivie/db-postgres";
import type { PostgresAdapter } from "@arivie/db-postgres";
import { describe, expect, it, vi } from "vitest";
import { executeToolFor } from "../src/tools/execute.js";

function mockDb(executeFn = vi.fn()): PostgresAdapter {
  return {
    url: "postgres://test",
    sql: {} as PostgresAdapter["sql"],
    execute: executeFn,
    introspect: vi.fn(),
    verifyOwnerIdentity: vi.fn(),
    setupRole: vi.fn(),
  };
}

describe("executeToolFor", () => {
  const ownerId = "owner-1";
  const user = {
    userId: "user-1",
    permissions: ["read"],
    dbRole: "arivie_reader",
  };

  it("rejects non-SELECT/WITH statements", async () => {
    const tool = executeToolFor({
      db: mockDb(),
      ownerId,
      sourceName: "postgres",
      limits: {},
    });

    await expect(
      runWithUserContext(user, () =>
        tool.execute!({ sql: "DELETE FROM orders" }, {}),
      ),
    ).rejects.toBeInstanceOf(ToolError);

    await expect(
      runWithUserContext(user, () =>
        tool.execute!({ sql: "DELETE FROM orders" }, {}),
      ),
    ).rejects.toMatchObject({
      kind: "sql-invalid",
      message: "only SELECT and WITH statements are allowed",
    });
  });

  it("rejects system catalog access", async () => {
    const tool = executeToolFor({
      db: mockDb(),
      ownerId,
      sourceName: "postgres",
      limits: {},
    });

    await expect(
      runWithUserContext(user, () =>
        tool.execute!(
          { sql: "SELECT * FROM pg_catalog.pg_tables" },
          {},
        ),
      ),
    ).rejects.toMatchObject({
      kind: "sql-blocked",
      message: "system catalog access is blocked",
    });

    await expect(
      runWithUserContext(user, () =>
        tool.execute!(
          { sql: "SELECT table_name FROM information_schema.tables" },
          {},
        ),
      ),
    ).rejects.toMatchObject({ kind: "sql-blocked" });
  });

  it("rejects when user context is missing", async () => {
    const tool = executeToolFor({
      db: mockDb(),
      ownerId,
      sourceName: "postgres",
      limits: {},
    });

    await expect(tool.execute!({ sql: "SELECT 1" }, {})).rejects.toThrow(
      "no user context — auth resolver did not run",
    );
  });

  it("executes SELECT via the adapter and fires lifecycle hooks", async () => {
    const execute = vi.fn().mockResolvedValue({
      rows: [{ n: 1 }],
      rowCount: 1,
      durationMs: 12,
      truncated: false,
    });
    const onBeforeQuery = vi.fn().mockResolvedValue(undefined);
    const onAfterQuery = vi.fn().mockResolvedValue(undefined);

    const tool = executeToolFor({
      db: mockDb(execute),
      ownerId,
      sourceName: "postgres",
      limits: { rowsPerQuery: 10, queryTimeoutMs: 5000 },
      hooks: { onBeforeQuery, onAfterQuery },
    });

    const result = await runWithUserContext(user, () =>
      tool.execute!({ sql: "  SELECT 1  " }, {}),
    );

    expect(execute).toHaveBeenCalledWith({
      query: "SELECT 1",
      runAsRole: "arivie_reader",
      userId: "user-1",
      rowLimit: 10,
      timeoutMs: 5000,
    });
    expect(onBeforeQuery).toHaveBeenCalledWith({
      sql: "SELECT 1",
      userId: "user-1",
      ownerId,
    });
    expect(onAfterQuery).toHaveBeenCalledWith({
      sql: "SELECT 1",
      rows: [{ n: 1 }],
      durationMs: 12,
      userId: "user-1",
      ownerId,
    });
    expect(result).toEqual({
      rows: [{ n: 1 }],
      rowCount: 1,
      truncated: false,
    });
  });

  it("accepts WITH statements", async () => {
    const execute = vi.fn().mockResolvedValue({
      rows: [],
      rowCount: 0,
      durationMs: 1,
      truncated: false,
    });
    const tool = executeToolFor({
      db: mockDb(execute),
      ownerId,
      sourceName: "postgres",
      limits: {},
    });

    await runWithUserContext(user, () =>
      tool.execute!(
        { sql: "WITH cte AS (SELECT 1) SELECT * FROM cte" },
        {},
      ),
    );

    expect(execute).toHaveBeenCalledOnce();
  });

  it("threads credentials[sourceName] into adapter.execute", async () => {
    const execute = vi.fn().mockResolvedValue({
      rows: [],
      rowCount: 0,
      durationMs: 1,
      truncated: false,
    });
    const tool = executeToolFor({
      db: mockDb(execute),
      ownerId,
      sourceName: "postgres",
      limits: {},
    });

    const creds = { password: "from-resolve-user" };
    await runWithUserContext(
      { ...user, credentials: { postgres: creds } },
      () => tool.execute!({ sql: "SELECT 1" }, {}),
    );

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ credentials: creds }),
    );
  });
});
