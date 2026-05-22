/* SPDX-License-Identifier: Apache-2.0 */
import { execSync } from "node:child_process";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ArivieBoundaryError,
  postgresAdapter,
  ToolError,
} from "../src/index.js";
import { escapeIdent } from "../src/identifier.js";
import { verifyOwnerIdentity } from "../src/verify.js";
import type { PostgresAdapter } from "../src/types.js";

function dockerAvailable(): boolean {
  try {
    execSync("docker info", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const describeIntegration = describe.skipIf(!dockerAvailable());

describeIntegration("@arivie/db-postgres integration", () => {
  let container: Awaited<ReturnType<PostgreSqlContainer["start"]>>;
  let adapter: PostgresAdapter;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16-alpine").start();
    adapter = postgresAdapter({ url: container.getConnectionUri() });
    await adapter.setupRole("arivie_reader");
    await adapter.setupRole("arivie_reader");
    await adapter.sql`
      INSERT INTO arivie_owner_identity (key, value)
      VALUES ('owner_id', 'test-owner')
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `;
  }, 120_000);

  afterAll(async () => {
    await adapter.sql.end();
    await container.stop();
  });

  it("verifyOwnerIdentity succeeds for matching owner", async () => {
    await expect(
      verifyOwnerIdentity(adapter.sql, "test-owner"),
    ).resolves.toBeUndefined();
    await expect(adapter.verifyOwnerIdentity("test-owner")).resolves.toBeUndefined();
  });

  it("verifyOwnerIdentity throws on mismatch", async () => {
    await expect(adapter.verifyOwnerIdentity("wrong")).rejects.toMatchObject({
      code: "ARIVIE_BOUNDARY_ERROR",
      detail: { reason: "identity-mismatch", expected: "wrong" },
    });
    await expect(adapter.verifyOwnerIdentity("wrong")).rejects.toBeInstanceOf(
      ArivieBoundaryError,
    );
  });

  it("setupRole is idempotent", async () => {
    await expect(adapter.setupRole("arivie_reader")).resolves.toBeUndefined();
    await expect(adapter.setupRole("arivie_reader")).resolves.toBeUndefined();
  });

  it("parallel setupRole calls both succeed", async () => {
    await expect(
      Promise.all([
        adapter.setupRole("arivie_reader"),
        adapter.setupRole("arivie_reader"),
      ]),
    ).resolves.toEqual([undefined, undefined]);
  });

  it("execute returns SELECT results under reader role", async () => {
    const result = await adapter.execute({
      query: "SELECT 1 as one",
      runAsRole: "arivie_reader",
      userId: "u1",
      rowLimit: 10,
      timeoutMs: 5000,
    });

    expect(result).toEqual({
      rows: [{ one: 1 }],
      rowCount: 1,
      truncated: false,
      durationMs: expect.any(Number),
    });
  });

  it("execute binds params via $1 placeholders", async () => {
    const result = await adapter.execute({
      query: "SELECT $1::int AS x",
      params: [42],
      runAsRole: "arivie_reader",
      userId: "u1",
      rowLimit: 10,
      timeoutMs: 5000,
    });

    expect(result.rows).toEqual([{ x: 42 }]);
  });

  it("execute treats params as literals (injection string not interpolated)", async () => {
    const injection = "'; DROP TABLE foo; --";
    const result = await adapter.execute({
      query: "SELECT $1::text AS x",
      params: [injection],
      runAsRole: "arivie_reader",
      userId: "u1",
      rowLimit: 10,
      timeoutMs: 5000,
    });

    expect(result.rows).toEqual([{ x: injection }]);
  });

  it("execute rejects permission denied as ToolError", async () => {
    const tableName = "arivie_perm_denied_test";
    await adapter.sql.unsafe(
      `CREATE TABLE IF NOT EXISTS ${escapeIdent(tableName)} (id int)`,
    );
    await adapter.sql.unsafe(`REVOKE ALL ON TABLE public.${escapeIdent(tableName)} FROM arivie_reader`);

    await expect(
      adapter.execute({
        query: `SELECT * FROM ${tableName}`,
        runAsRole: "arivie_reader",
        userId: "u1",
        rowLimit: 10,
        timeoutMs: 5000,
      }),
    ).rejects.toMatchObject({
      code: "ARIVIE_TOOL_ERROR",
      kind: "sql-permission-denied",
    });
  });

  it("execute truncates rows to rowLimit", async () => {
    const tableName = "arivie_trunc_test";
    await adapter.sql.unsafe(
      `CREATE TABLE IF NOT EXISTS ${escapeIdent(tableName)} (n int)`,
    );
    await adapter.sql.unsafe(`TRUNCATE ${escapeIdent(tableName)}`);
    await adapter.sql.unsafe(
      `INSERT INTO ${escapeIdent(tableName)} (n) SELECT generate_series(1, 20)`,
    );
    await adapter.sql.unsafe(
      `GRANT SELECT ON TABLE public.${escapeIdent(tableName)} TO arivie_reader`,
    );

    const result = await adapter.execute({
      query: `SELECT n FROM ${tableName} ORDER BY n`,
      runAsRole: "arivie_reader",
      userId: "u1",
      rowLimit: 5,
      timeoutMs: 5000,
    });

    expect(result.rows).toHaveLength(5);
    expect(result.rowCount).toBe(5);
    expect(result.truncated).toBe(true);
  });

  it("introspect returns public tables", async () => {
    const tables = await adapter.introspect();
    expect(tables.some((t) => t.name === "arivie_owner_identity")).toBe(true);
    const ownerTable = tables.find((t) => t.name === "arivie_owner_identity");
    expect(ownerTable?.schema).toBe("public");
    expect(ownerTable?.columns.length).toBeGreaterThan(0);
  });
});

describe("escapeIdent", () => {
  it("quotes valid identifiers", () => {
    expect(escapeIdent("valid_role")).toBe('"valid_role"');
  });

  it("rejects invalid identifiers", () => {
    expect(() => escapeIdent("drop;table")).toThrow(ToolError);
    try {
      escapeIdent("drop;table");
    } catch (err) {
      expect(err).toBeInstanceOf(ToolError);
      expect((err as ToolError).kind).toBe("sql-invalid");
    }
  });
});
