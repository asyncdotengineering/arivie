/* SPDX-License-Identifier: Apache-2.0 */
/**
 * REQ-27: MCP-stdio and HTTP handler must yield structurally identical answers
 * (same SQL, row count, assumptions) for fixed dogfood questions.
 */
import { execSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { MCPClient } from "@mastra/mcp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { postgresAdapter } from "@arivie/db-postgres";
import { runWithUserContext } from "@arivie/core/context";
import { defineArivie } from "@arivie/core";
import { PARITY_PROBES, createParityMockModel } from "../../scripts/parity-mock-model.js";
import {
  assumptionsEqual,
  normalizeSql,
  parityFromAgentGenerate,
  parityFromMcpAsk,
  type ParityFields,
} from "./_parity-helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARIVIE_ROOT = join(__dirname, "../..");
const STDIO_RUNNER = join(__dirname, "_stdio-runner.ts");
const SEED_SQL = join(ARIVIE_ROOT, "scripts", "seed-dogfood.sql");
const SEM5_FIXTURE = join(
  ARIVIE_ROOT,
  "packages/agent/test/fixtures/sem-5",
);

function dockerAvailable(): boolean {
  try {
    execSync("docker info", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const describeParity = describe.skipIf(!dockerAvailable());

const MCP_DISCONNECT_TIMEOUT_MS = 5_000;

async function disconnectMcpClientWithHardKill(
  client: MCPClient,
  stdioRunnerPath: string,
): Promise<void> {
  try {
    await Promise.race([
      client.disconnect(),
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error("MCP disconnect timed out")),
          MCP_DISCONNECT_TIMEOUT_MS,
        );
      }),
    ]);
  } catch {
    if (process.platform !== "win32") {
      try {
        execSync(`pkill -f "${stdioRunnerPath}"`, { stdio: "ignore" });
      } catch {
        // Process may already have exited.
      }
      try {
        execSync(`pkill -9 -f "${stdioRunnerPath}"`, { stdio: "ignore" });
      } catch {
        // Best-effort hard kill.
      }
    }
  }
}

function formatAssumptions(tags: string[]): string {
  if (tags.length === 0) {
    return "[]";
  }
  return `[${tags.join(", ")}]`;
}

describeParity.sequential("MCP ↔ HTTP parity (REQ-27)", () => {
  let container: Awaited<ReturnType<PostgreSqlContainer["start"]>>;
  let connectionUrl: string;
  let httpInstance: ReturnType<typeof defineArivie>;
  let mcpClient: MCPClient;
  const artifactLines: string[] = [];

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16-alpine").start();
    connectionUrl = container.getConnectionUri();

    const setupDb = postgresAdapter({ url: connectionUrl });
    try {
      await setupDb.setupRole("arivie_reader");
      await setupDb.sql.unsafe(
        `ALTER ROLE arivie_reader WITH LOGIN PASSWORD 'test-arivie-reader'`,
      );
      const seedSql = await readFile(SEED_SQL, "utf8");
      await setupDb.sql.unsafe(seedSql);
      await setupDb.sql`
        INSERT INTO arivie_owner_identity (key, value)
        VALUES ('owner_id', 'parity-owner')
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
      `;
      await setupDb.sql.unsafe(`GRANT SELECT ON TABLE orders TO arivie_reader`);
    } finally {
      await setupDb.sql.end();
    }

    const db = postgresAdapter({ url: connectionUrl });
    httpInstance = defineArivie({
      owner: { id: "parity-owner", name: "Parity" },
      model: createParityMockModel(),
      db,
      semantic: { path: SEM5_FIXTURE, mode: "preload" },
      resolveUser: async () => ({
        userId: "parity-user",
        permissions: [],
        dbRole: "arivie_reader",
      }),
      limits: { rowsPerQuery: 500, queryTimeoutMs: 30_000 },
    });

    const storage = httpInstance.mastra.getStorage();
    if (
      storage != null &&
      "init" in storage &&
      typeof storage.init === "function"
    ) {
      await storage.init();
    }

    await runWithUserContext(
      {
        userId: "parity-user",
        permissions: [],
        dbRole: "arivie_reader",
      },
      async () => {
        await httpInstance.agent.generate("warmup", {
          memory: { thread: "parity-warmup", resource: "parity-user" },
        });
      },
    );

    const setupForMastra = postgresAdapter({ url: connectionUrl });
    const mastraTables = await setupForMastra.sql<{ tablename: string }[]>`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public' AND tablename LIKE 'mastra_%'
    `;
    for (const row of mastraTables) {
      await setupForMastra.sql.unsafe(
        `ALTER TABLE public.${row.tablename} OWNER TO arivie_reader`,
      );
      await setupForMastra.sql.unsafe(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.${row.tablename} TO arivie_reader`,
      );
    }
    await setupForMastra.sql.unsafe(
      `GRANT USAGE, CREATE ON SCHEMA public TO arivie_reader`,
    );
    await setupForMastra.sql.end();

    process.env.ARIVIE_TEST_PG_URL = connectionUrl;
    process.env.ARIVIE_TEST_SEM_DIR = SEM5_FIXTURE;

    mcpClient = new MCPClient({
      id: "s3-03-parity",
      servers: {
        arivie: {
          command: "tsx",
          args: [STDIO_RUNNER],
          cwd: ARIVIE_ROOT,
          env: {
            ARIVIE_TEST_PG_URL: connectionUrl,
            ARIVIE_TEST_SEM_DIR: SEM5_FIXTURE,
          },
        },
      },
      timeout: 60_000,
    });
  }, 120_000);

  afterAll(async () => {
    if (mcpClient != null) {
      await disconnectMcpClientWithHardKill(mcpClient, STDIO_RUNNER);
    }
    if (httpInstance?.mastra.shutdown) {
      await httpInstance.mastra.shutdown();
    }
    const storage = httpInstance?.mastra.getStorage();
    if (
      storage != null &&
      "close" in storage &&
      typeof storage.close === "function"
    ) {
      await storage.close();
    }
    if (container != null) {
      await container.stop();
    }

    if (artifactLines.length > 0) {
      const { mkdir, writeFile } = await import("node:fs/promises");
      const artifactDir = join(
        ARIVIE_ROOT,
        "..",
        ".research",
        "sprints",
        "sprint-3",
        "artifacts",
      );
      await mkdir(artifactDir, { recursive: true });
      await writeFile(
        join(artifactDir, "c23-parity.txt"),
        `${artifactLines.join("\n")}\n`,
        "utf8",
      );
    }
  }, 60_000);

  const parityUser = {
    userId: "parity-user",
    permissions: [] as string[],
    dbRole: "arivie_reader",
  };

  async function askHttp(question: string): Promise<ParityFields> {
    const response = await httpInstance.handler(
      new Request("http://localhost/arivie", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: question }),
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { answer: string };

    const fields = await runWithUserContext(parityUser, async () => {
      const result = await httpInstance.agent.generate(
        [{ role: "user" as const, content: question }],
        {
          memory: {
            thread: `parity-http-${question}`,
            resource: parityUser.userId,
          },
        },
      );
      return parityFromAgentGenerate(result);
    });

    return {
      ...fields,
      answer: body.answer.length > 0 ? body.answer : fields.answer,
    };
  }

  async function askMcp(question: string): Promise<ParityFields> {
    const toolsets = await mcpClient.listToolsets();
    const ask = toolsets.arivie?.ask;
    if (ask?.execute == null) {
      throw new Error("MCP ask tool not available on arivie server");
    }
    const raw = await ask.execute({ prompt: question }, {});
    return parityFromMcpAsk(raw);
  }

  function assertStructuralParity(
    question: string,
    httpFields: ParityFields,
    mcpFields: ParityFields,
  ): void {
    expect(normalizeSql(httpFields.sql)).toBe(normalizeSql(mcpFields.sql));
    expect(httpFields.rowCount).toBe(mcpFields.rowCount);
    expect(assumptionsEqual(httpFields.assumptions, mcpFields.assumptions)).toBe(
      true,
    );

    artifactLines.push(`Question: "${question}"`);
    artifactLines.push(
      `  HTTP:  sql=${normalizeSql(httpFields.sql)}  rowCount=${httpFields.rowCount}  assumptions=${formatAssumptions(httpFields.assumptions)}`,
    );
    artifactLines.push(
      `  MCP:   sql=${normalizeSql(mcpFields.sql)}  rowCount=${mcpFields.rowCount}  assumptions=${formatAssumptions(mcpFields.assumptions)}`,
    );
    artifactLines.push("  PASS (structural equivalence)");
    artifactLines.push("");
  }

  it("records parity artifact header", () => {
    artifactLines.push("=== Parity test ===");
  });

  for (const probe of PARITY_PROBES) {
    it(`HTTP and MCP agree for: ${probe.question}`, async () => {
      const [httpFields, mcpFields] = await Promise.all([
        askHttp(probe.question),
        askMcp(probe.question),
      ]);

      expect(httpFields.sql.length).toBeGreaterThan(0);
      expect(mcpFields.sql.length).toBeGreaterThan(0);
      expect(httpFields.rowCount).toBeGreaterThan(0);

      assertStructuralParity(probe.question, httpFields, mcpFields);
    }, 60_000);
  }
});
