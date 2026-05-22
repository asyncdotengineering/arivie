/* SPDX-License-Identifier: Apache-2.0 */
import { execSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runWithUserContext } from "@arivie/core/context";
import type { SourceAdapter } from "@arivie/core/types";
import { compileMetricForPostgres, postgresAdapter, ToolError } from "@arivie/db-postgres";
import type { PostgresAdapter } from "@arivie/db-postgres";
import { compileMetricForMixpanel, mixpanelAdapter } from "@arivie/source-mixpanel";
import { loadSemanticLayerSync, type Entity, type SemanticLayer } from "@arivie/semantic";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { dispatchCompileMetric } from "../src/tools/compile-metric-dispatch.js";
import { compileMetricFor } from "../src/tools/compile-metric.js";

const fixturesDir = join(fileURLToPath(new URL(".", import.meta.url)), "fixtures");
const semWithJoins = loadSemanticLayerSync(join(fixturesDir, "sem-with-joins"));

function layerFromEntities(entities: Entity[]): SemanticLayer {
  const map = new Map(entities.map((e) => [e.name, e]));
  return {
    entities: map,
    catalog: {
      entities: entities.map((e) => e.name),
      generated_at: "2026-01-01T00:00:00.000Z",
      source_files: [],
    },
  };
}

const semCrossSource = layerFromEntities([
  {
    name: "orders",
    description: "Orders",
    grain: "one row",
    primary_key: "id",
    source: { adapter: "postgres", instance: "primary" },
    measures: [{ name: "revenue", sql: "SUM(total_amount)" }],
    dimensions: [{ name: "user_id", sql: "user_id", type: "text" }],
    columns: [
      { name: "email", type: "text", description: "email", pii: true },
      { name: "user_id", type: "text", description: "user_id" },
    ],
    joins: [
      {
        to: "events",
        on: "orders.user_id = events.distinct_id",
        strategy: "client-side",
      },
    ],
  },
  {
    name: "events",
    description: "Mixpanel events",
    grain: "one row",
    primary_key: "id",
    source: { adapter: "mixpanel", instance: "primary" },
    measures: [{ name: "event_count", sql: "COUNT(*)" }],
    dimensions: [{ name: "event_name", sql: "event_name", type: "text" }],
    columns: [{ name: "distinct_id", type: "text", description: "distinct_id" }],
  },
]);

const semMixpanelOnly = layerFromEntities([
  {
    name: "events",
    description: "Mixpanel events",
    grain: "one row",
    primary_key: "id",
    source: { adapter: "mixpanel", instance: "primary" },
    measures: [{ name: "event_count", sql: "COUNT(*)" }],
    dimensions: [{ name: "event_name", sql: "event_name", type: "text" }],
  },
]);

function dockerAvailable(): boolean {
  try {
    execSync("docker info", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const describeIntegration = describe.skipIf(!dockerAvailable());

const user = {
  userId: "user-1",
  permissions: ["read"],
  dbRole: "arivie_reader",
};

describe("dispatchCompileMetric", () => {
  it("Postgres-bound entity returns SQL", async () => {
    const execute = vi.fn().mockResolvedValue({
      rows: [{ revenue: 100 }],
      rowCount: 1,
      durationMs: 1,
      truncated: false,
    });
    const sources: Record<string, SourceAdapter<unknown>> = {
      postgres: {
        kind: "postgres",
        id: "postgres:test",
        execute,
        introspect: vi.fn(),
        verifyOwnerIdentity: vi.fn(),
        compileMetric: compileMetricForPostgres,
      },
    };

    const result = await runWithUserContext(user, () =>
      dispatchCompileMetric(
        {
          semantic: semWithJoins,
          sources,
          ownerId: "owner-1",
          limits: {},
        },
        { metric: "revenue" },
      ),
    );

    expect(result.sql).toBe(
      'SELECT (SUM(total_amount)) AS "revenue" FROM orders',
    );
    expect(execute).toHaveBeenCalled();
  });

  it("Mixpanel-bound entity returns Mixpanel query JSON", async () => {
    const execute = vi.fn().mockResolvedValue({
      rows: [{ event_count: 42 }],
      rowCount: 1,
      durationMs: 1,
      truncated: false,
    });
    const sources: Record<string, SourceAdapter<unknown>> = {
      mixpanel: {
        kind: "mixpanel",
        id: "mixpanel:1:abc",
        execute,
        introspect: vi.fn(),
        verifyOwnerIdentity: vi.fn(),
        compileMetric: compileMetricForMixpanel,
      },
    };

    const result = await runWithUserContext(user, () =>
      dispatchCompileMetric(
        {
          semantic: semMixpanelOnly,
          sources,
          ownerId: "owner-1",
          limits: {},
        },
        { metric: "event_count" },
      ),
    );

    const parsed = JSON.parse(result.sql) as { aggregate: string };
    expect(parsed.aggregate).toBe("count");
    expect(execute).toHaveBeenCalled();
  });

  it("cross-source client-side join executes both sides and hash-joins", async () => {
    const postgresExecute = vi.fn().mockResolvedValue({
      rows: [
        { revenue: 50, user_id: "u1" },
        { revenue: 50, user_id: "u2" },
      ],
      rowCount: 2,
      durationMs: 1,
      truncated: false,
    });
    const mixpanelExecute = vi.fn().mockResolvedValue({
      rows: [
        { event_count: 3, distinct_id: "u1", event_name: "Page Viewed" },
        { event_count: 1, distinct_id: "u2", event_name: "Signup" },
      ],
      rowCount: 2,
      durationMs: 1,
      truncated: false,
    });

    const sources: Record<string, SourceAdapter<unknown>> = {
      postgres: {
        kind: "postgres",
        id: "postgres:test",
        execute: postgresExecute,
        introspect: vi.fn(),
        verifyOwnerIdentity: vi.fn(),
        compileMetric: compileMetricForPostgres,
      },
      mixpanel: {
        kind: "mixpanel",
        id: "mixpanel:1:abc",
        execute: mixpanelExecute,
        introspect: vi.fn(),
        verifyOwnerIdentity: vi.fn(),
        compileMetric: compileMetricForMixpanel,
      },
    };

    const result = await runWithUserContext(user, () =>
      dispatchCompileMetric(
        {
          semantic: semCrossSource,
          sources,
          ownerId: "owner-1",
          limits: {},
        },
        { metric: "revenue", dimensions: ["events.event_name"] },
      ),
    );

    expect(postgresExecute).toHaveBeenCalled();
    expect(mixpanelExecute).toHaveBeenCalled();
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).not.toHaveProperty("email");
    expect(result.rows[0]).toMatchObject({
      revenue: 50,
      user_id: "u1",
      event_name: "Page Viewed",
    });
    const queries = JSON.parse(result.sql) as unknown[];
    expect(queries).toHaveLength(2);
  });
});

describe("compileMetricFor", () => {
  it("throws when user context is missing", async () => {
    const tool = compileMetricFor({
      semantic: semWithJoins,
      sources: {
        postgres: {
          kind: "postgres",
          id: "postgres:test",
          execute: vi.fn(),
          introspect: vi.fn(),
          verifyOwnerIdentity: vi.fn(),
          compileMetric: compileMetricForPostgres,
        },
      },
      ownerId: "owner-1",
      limits: {},
    });

    await expect(tool.execute!({ metric: "revenue" }, {})).rejects.toThrow(
      "no user context — auth resolver did not run",
    );
  });

  it("fires lifecycle hooks on execute", async () => {
    const execute = vi.fn().mockResolvedValue({
      rows: [{ revenue: 100 }],
      rowCount: 1,
      durationMs: 5,
      truncated: false,
    });
    const onBeforeQuery = vi.fn().mockResolvedValue(undefined);
    const onAfterQuery = vi.fn().mockResolvedValue(undefined);

    const tool = compileMetricFor({
      semantic: semWithJoins,
      sources: {
        postgres: {
          kind: "postgres",
          id: "postgres:test",
          execute,
          introspect: vi.fn(),
          verifyOwnerIdentity: vi.fn(),
          compileMetric: compileMetricForPostgres,
        },
      },
      ownerId: "owner-1",
      limits: { rowsPerQuery: 10, queryTimeoutMs: 5000 },
      hooks: { onBeforeQuery, onAfterQuery },
    });

    const result = await runWithUserContext(user, () =>
      tool.execute!({ metric: "revenue" }, {}),
    );

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'SELECT (SUM(total_amount)) AS "revenue" FROM orders',
        params: [],
        runAsRole: "arivie_reader",
        userId: "user-1",
        rowLimit: 10,
        timeoutMs: 5000,
      }),
    );
    expect(onBeforeQuery).toHaveBeenCalled();
    expect(onAfterQuery).toHaveBeenCalled();
    expect(result).toMatchObject({
      rowCount: 1,
      rows: [{ revenue: 100 }],
    });
  });
});

describeIntegration("compileMetricFor integration", () => {
  let container: Awaited<ReturnType<PostgreSqlContainer["start"]>>;
  let adapter: PostgresAdapter;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16-alpine").start();
    adapter = postgresAdapter({ url: container.getConnectionUri() });
    await adapter.setupRole("arivie_reader");
    await adapter.sql`
      INSERT INTO arivie_owner_identity (key, value)
      VALUES ('owner_id', 'test-owner')
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `;
    await adapter.sql.unsafe(`
      CREATE TABLE IF NOT EXISTS customers (
        id serial PRIMARY KEY,
        region text
      );
      CREATE TABLE IF NOT EXISTS products (
        id serial PRIMARY KEY,
        category text
      );
      CREATE TABLE IF NOT EXISTS orders (
        id serial PRIMARY KEY,
        total_amount numeric,
        status text,
        customer_id int REFERENCES customers(id),
        product_id int REFERENCES products(id),
        created_at timestamptz DEFAULT now()
      );
      TRUNCATE orders, customers, products RESTART IDENTITY CASCADE;
      INSERT INTO customers (region) VALUES ('west'), ('east');
      INSERT INTO products (category) VALUES ('apparel'), ('electronics');
      INSERT INTO orders (total_amount, status, customer_id, product_id)
      VALUES (100, 'completed', 1, 1), (200, 'completed', 2, 2);
      GRANT SELECT ON customers, products, orders TO arivie_reader;
    `);
  }, 120_000);

  afterAll(async () => {
    await adapter.sql.end();
    await container.stop();
  });

  it("executes compiled metric and returns rows", async () => {
    const tool = compileMetricFor({
      semantic: semWithJoins,
      sources: { postgres: adapter },
      ownerId: "test-owner",
      limits: { rowsPerQuery: 10, queryTimeoutMs: 5000 },
    });

    const result = await runWithUserContext(user, () =>
      tool.execute!({ metric: "revenue" }, {}),
    );

    expect(result.rowCount).toBe(1);
    expect(Number(result.rows[0]?.revenue)).toBe(300);
    expect(result.params).toEqual([]);
  });
});
