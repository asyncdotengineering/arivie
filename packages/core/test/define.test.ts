/* SPDX-License-Identifier: Apache-2.0 */
import { execSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import type { MastraVector } from "@mastra/core/vector";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { postgresAdapter, type PostgresAdapter } from "@arivie/db-postgres";
import type { ArivieInstance } from "../src/types.js";
import { ArivieConfigError, defineArivie } from "../src/define.js";
import { mockEmbeddingProvider } from "../../agent/test/_mock-provider.js";

const sem5FixturePath = join(
  fileURLToPath(new URL("../../agent/test/fixtures/sem-5", import.meta.url)),
);
const sem60FixturePath = join(
  fileURLToPath(new URL("../../agent/test/fixtures/sem-60", import.meta.url)),
);

function dockerAvailable(): boolean {
  try {
    execSync("docker info", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const describeIntegration = describe.skipIf(!dockerAvailable());

const STREAM_FINISH_USAGE = {
  inputTokens: {
    total: 0,
    noCache: 0,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: {
    total: 0,
    text: 0,
    reasoning: undefined,
  },
};

const stubModel = new MockLanguageModelV3({
  provider: "mock",
  modelId: "mock",
  doGenerate: {
    content: [{ type: "text", text: "Arivie foundation: ready" }],
    finishReason: "stop",
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    warnings: [],
  },
  doStream: async () => ({
    stream: simulateReadableStream({
      chunks: [
        { type: "text-start", id: "text-1" },
        { type: "text-delta", id: "text-1", delta: "Arivie foundation: " },
        { type: "text-delta", id: "text-1", delta: "ready" },
        { type: "text-end", id: "text-1" },
        {
          type: "finish",
          finishReason: { unified: "stop", raw: undefined },
          logprobs: undefined,
          usage: STREAM_FINISH_USAGE,
        },
      ],
    }),
  }),
});

function readerConnectionUrl(superuserUrl: string): string {
  const url = new URL(superuserUrl);
  url.username = "arivie_reader";
  url.password = "test-arivie-reader";
  return url.toString();
}

function parseSseEvents(body: string): string[] {
  return body
    .split("\n\n")
    .map((block) => block.trim())
    .filter((block) => block.startsWith("data: "))
    .map((block) => block.slice("data: ".length));
}

describeIntegration.sequential("@arivie/core defineArivie integration", () => {
  let container: Awaited<ReturnType<PostgreSqlContainer["start"]>>;
  let connectionUrl: string;
  let readerUrl: string;
  let readerAdapter: PostgresAdapter;
  let semanticPath: string;
  const instances: ArivieInstance[] = [];
  const adapters: PostgresAdapter[] = [];

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16-alpine").start();
    connectionUrl = container.getConnectionUri();
    readerUrl = readerConnectionUrl(connectionUrl);

    const adapter = postgresAdapter({ url: connectionUrl });
    await adapter.setupRole("arivie_reader");
    await adapter.sql.unsafe(
      `ALTER ROLE arivie_reader WITH LOGIN PASSWORD 'test-arivie-reader'`,
    );
    await adapter.sql`
      INSERT INTO arivie_owner_identity (key, value)
      VALUES ('owner_id', 'test-owner')
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `;
    await adapter.sql.end();

    readerAdapter = postgresAdapter({ url: readerUrl });

    semanticPath = join(tmpdir(), `arivie-semantic-${Date.now()}`);
    await mkdir(join(semanticPath, "entities"), { recursive: true });
    await writeFile(join(semanticPath, "entities", ".gitkeep"), "");

    const warmup = await defineArivie({
      owner: { id: "test-owner", name: "Test" },
      model: stubModel,
      workspace: { rootDir: semanticPath },
      sources: {
        postgres: {
          adapter: postgresAdapter({ url: connectionUrl }),
          description: "Test source.",
        },
      },
      semantic: { path: semanticPath, mode: "auto" as const },
      resolveUser: async () => ({
        userId: "u1",
        permissions: [] as string[],
        dbRole: "arivie_reader",
      }),
    });
    const storage = warmup.mastra.getStorage();
    if (
      storage != null &&
      "init" in storage &&
      typeof storage.init === "function"
    ) {
      await storage.init();
    }
    await warmup.handler(
      new Request("http://localhost/arivie", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "warmup" }),
      }),
    );
    await teardownInstance(warmup);
  }, 120_000);

  async function grantMastraTablesToReader(): Promise<void> {
    const setup = postgresAdapter({ url: connectionUrl });
    const tables = await setup.sql<{ tablename: string }[]>`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public' AND tablename LIKE 'mastra_%'
    `;
    for (const row of tables) {
      await setup.sql.unsafe(
        `ALTER TABLE public.${row.tablename} OWNER TO arivie_reader`,
      );
      await setup.sql.unsafe(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.${row.tablename} TO arivie_reader`,
      );
    }
    await setup.sql.unsafe(
      `GRANT USAGE, CREATE ON SCHEMA public TO arivie_reader`,
    );
    await setup.sql.end();
  }

  afterEach(async () => {
    while (instances.length > 0) {
      const instance = instances.pop();
      if (instance) {
        await teardownInstance(instance);
      }
    }
    while (adapters.length > 0) {
      const adapter = adapters.pop();
      if (adapter) {
        await adapter.sql.end({ timeout: 5 });
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  });

  afterAll(async () => {
    await readerAdapter.sql.end({ timeout: 5 });
    await new Promise((resolve) => setTimeout(resolve, 500));
    await container.stop();
  });

  function track(instance: ArivieInstance): ArivieInstance {
    instances.push(instance);
    return instance;
  }

  async function teardownInstance(instance: ArivieInstance): Promise<void> {
    await instance.dispose();
    const storage = instance.mastra.getStorage();
    if (
      storage != null &&
      "close" in storage &&
      typeof storage.close === "function"
    ) {
      await storage.close();
    }
    if (instance.mastra.shutdown) {
      await instance.mastra.shutdown();
    }
  }

  function baseConfig(ownerId: string, options?: { useReaderAdapter?: boolean }) {
    const postgres = options?.useReaderAdapter
      ? readerAdapter
      : postgresAdapter({ url: connectionUrl });
    if (!options?.useReaderAdapter) {
      adapters.push(postgres);
    }
    return {
      owner: { id: ownerId, name: "Test" },
      model: stubModel,
      workspace: { rootDir: semanticPath },
      sources: {
        postgres: { adapter: postgres, description: "Test source." },
      },
      semantic: { path: semanticPath, mode: "auto" as const },
      resolveUser: async () => ({
        userId: "u1",
        permissions: [] as string[],
        dbRole: "arivie_reader",
      }),
    };
  }

  it("agent.generate returns a non-empty stub response", async () => {
    const instance = track(await defineArivie(baseConfig("test-owner")));
    const result = await instance.agent.generate("hello");
    const text =
      typeof result === "object" && result != null && "text" in result
        ? String((result as { text: unknown }).text)
        : "";
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain("Arivie foundation: ready");
  }, 60_000);

  it("handler returns 200 JSON with answer on happy path", async () => {
    const instance = track(await defineArivie(baseConfig("test-owner")));
    const response = await instance.handler(
      new Request("http://localhost/arivie", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "hello" }),
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { answer: string };
    expect(body.answer).toContain("Arivie foundation: ready");
  }, 60_000);

  it("handler streams SSE when Accept is text/event-stream", async () => {
    const instance = track(await defineArivie(baseConfig("test-owner")));
    const response = await instance.handler(
      new Request("http://localhost/arivie", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({ prompt: "hello" }),
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(response.headers.get("Cache-Control")).toBe("no-cache");
    expect(response.headers.get("Connection")).toBe("keep-alive");

    const raw = await response.text();
    const events = parseSseEvents(raw);
    const textChunks = events.filter(
      (event) => event !== "[DONE]" && !event.startsWith("{"),
    );
    expect(textChunks.length).toBeGreaterThan(0);
    expect(textChunks.join("")).toContain("Arivie foundation:");
    expect(textChunks.join("")).toContain("ready");
    expect(events).toContain("[DONE]");
    const finalJson = events.find((event) => event.startsWith("{"));
    expect(finalJson).toBeDefined();
    const parsed = JSON.parse(finalJson!) as { text?: string };
    expect(parsed.text).toContain("Arivie foundation: ready");
  }, 60_000);

  it("execute as arivie_reader rejects DELETE at DB role level", async () => {
    const tableName = "arivie_write_reject_test";
    const setup = postgresAdapter({ url: connectionUrl });
    adapters.push(setup);
    await setup.sql.unsafe(
      `CREATE TABLE IF NOT EXISTS public.${tableName} (id int)`,
    );
    await setup.sql.unsafe(`TRUNCATE public.${tableName}`);
    await setup.sql.unsafe(`INSERT INTO public.${tableName} (id) VALUES (1)`);
    await setup.sql.unsafe(
      `GRANT SELECT ON TABLE public.${tableName} TO arivie_reader`,
    );
    await setup.sql.end();

    await expect(
      readerAdapter.execute({
        query: `DELETE FROM ${tableName}`,
        runAsRole: "arivie_reader",
        userId: "u1",
        rowLimit: 10,
        timeoutMs: 5000,
      }),
    ).rejects.toMatchObject({
      code: "ARIVIE_TOOL_ERROR",
      kind: "sql-permission-denied",
    });
  }, 60_000);

  it("defineArivie uses arivie_reader adapter on the production DB path", async () => {
    await grantMastraTablesToReader();

    const roleRows = await readerAdapter.sql<{ current_user: string }[]>`
      SELECT current_user
    `;
    expect(roleRows[0]?.current_user).toBe("arivie_reader");

    const instance = track(
      await defineArivie(baseConfig("test-owner", { useReaderAdapter: true })),
    );
    const response = await instance.handler(
      new Request("http://localhost/arivie", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "hello" }),
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { answer: string };
    expect(body.answer).toContain("Arivie foundation: ready");
  }, 60_000);

  it("handler returns 503 on owner identity mismatch", async () => {
    const instance = track(await defineArivie(baseConfig("wrong-owner")));
    const response = await instance.handler(
      new Request("http://localhost/arivie", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "hello" }),
      }),
    );
    expect(response.status).toBe(503);
    const body = (await response.json()) as {
      error: string;
      detail: Record<string, unknown>;
    };
    expect(body.error).toBe("ARIVIE_BOUNDARY_ERROR");
    expect(body.detail).toMatchObject({
      reason: "identity-mismatch",
      expected: "wrong-owner",
    });
  }, 60_000);

  it("handler retries owner verification after transient failure", async () => {
    let verifyCalls = 0;
    const db = postgresAdapter({ url: connectionUrl });
    adapters.push(db);
    const flakyDb: PostgresAdapter = {
      ...db,
      async verifyOwnerIdentity(expectedOwnerId: string) {
        verifyCalls += 1;
        if (verifyCalls === 1) {
          throw new Error("ECONNREFUSED");
        }
        return db.verifyOwnerIdentity(expectedOwnerId);
      },
    };

    const instance = track(
      await defineArivie({
        owner: { id: "test-owner", name: "Test" },
        model: stubModel,
        workspace: { rootDir: semanticPath },
        sources: {
          postgres: { adapter: flakyDb, description: "Flaky test source." },
        },
        semantic: { path: semanticPath, mode: "auto" as const },
        resolveUser: async () => ({
          userId: "u1",
          permissions: [] as string[],
          dbRole: "arivie_reader",
        }),
      }),
    );
    const request = () =>
      new Request("http://localhost/arivie", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "hello" }),
      });

    const first = await instance.handler(request());
    expect(first.status).toBe(503);

    const second = await instance.handler(request());
    expect(second.status).toBe(200);
    const body = (await second.json()) as { answer: string };
    expect(body.answer).toContain("Arivie foundation: ready");
    expect(verifyCalls).toBe(2);
  }, 60_000);

  it("verifyPromise is shared across concurrent first requests (KI-1-06)", async () => {
    // Pi r2 M-r2-3 flagged the `verifyPromise ??=` memoisation as a possible
    // race. Proof of safety: fire N concurrent requests at a fresh handler and
    // assert the underlying verifyOwnerIdentity ran exactly once.
    let verifyCalls = 0;
    const db = postgresAdapter({ url: connectionUrl });
    adapters.push(db);
    const countingDb: PostgresAdapter = {
      ...db,
      async verifyOwnerIdentity(expectedOwnerId: string) {
        verifyCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 50));
        return db.verifyOwnerIdentity(expectedOwnerId);
      },
    };

    const instance = track(
      await defineArivie({
        owner: { id: "test-owner", name: "Test" },
        model: stubModel,
        workspace: { rootDir: semanticPath },
        sources: {
          postgres: { adapter: countingDb, description: "Counting test source." },
        },
        semantic: { path: semanticPath, mode: "auto" as const },
        resolveUser: async () => ({
          userId: "u1",
          permissions: [] as string[],
          dbRole: "arivie_reader",
        }),
      }),
    );
    const request = () =>
      new Request("http://localhost/arivie", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "hello" }),
      });

    const concurrent = await Promise.all(
      Array.from({ length: 10 }, () => instance.handler(request())),
    );
    for (const response of concurrent) {
      expect(response.status).toBe(200);
    }
    expect(verifyCalls).toBe(1);
  }, 60_000);

  it("defineArivie always constructs a workspace (REQ-33)", async () => {
    const instance = track(
      await defineArivie({
        ...baseConfig("test-owner"),
        semantic: { path: sem5FixturePath, mode: "preload" },
      }),
    );
    expect(instance.workspace).toBeDefined();
    const tools = await instance.agent.listTools();
    expect(tools).toHaveProperty("execute_postgres");
    expect(tools).not.toHaveProperty("explore");
  }, 60_000);

  it("defineArivie auto mode with sem-5 resolves to preload", async () => {
    const instance = track(
      await defineArivie({
        ...baseConfig("test-owner"),
        semantic: { path: sem5FixturePath, mode: "auto" },
      }),
    );
    const tools = await instance.agent.listTools();
    expect(tools).toHaveProperty("execute_postgres");
    expect(instance.workspace).toBeDefined();
  }, 60_000);

  it("defineArivie auto mode with sem-60 throws when embeddings are missing", async () => {
    await expect(
      defineArivie({
        ...baseConfig("test-owner"),
        semantic: { path: sem60FixturePath, mode: "auto" },
      }),
    ).rejects.toThrow(ArivieConfigError);
  });

  it("defineArivie in indexed mode requires embeddings at parse time", async () => {
    await expect(
      defineArivie({
        ...baseConfig("test-owner"),
        semantic: { path: sem5FixturePath, mode: "indexed" },
      }),
    ).rejects.toThrow(ArivieConfigError);
  });

  it("handler returns 401 when resolveUser throws", async () => {
    const instance = track(
      await defineArivie({
        ...baseConfig("test-owner"),
        resolveUser: async () => {
          throw new Error("no session");
        },
      }),
    );
    const response = await instance.handler(
      new Request("http://localhost/arivie", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "hello" }),
      }),
    );
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("unauthorized");
  }, 60_000);
});
