/* SPDX-License-Identifier: Apache-2.0 */
import { execSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { assertToolShape } from "@arivie/agent";
import { runWithUserContext } from "@arivie/core/context";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import { postgresAdapter } from "@arivie/db-postgres";
import type { ArivieInstance } from "../src/types.js";
import { defineArivie } from "../src/define.js";

const mockServerPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../source-mcp/test/fixtures/mock-server.ts",
);

const transcriptPath = join(
  fileURLToPath(
    new URL(
      "../../../../.research/sprints-v0.2/sprint-1/artifacts/c46-multi-source-transcript.txt",
      import.meta.url,
    ),
  ),
);

const transcriptLines: string[] = [];

function log(line: string): void {
  transcriptLines.push(line);
  console.log(line);
}

function dockerAvailable(): boolean {
  try {
    execSync("docker info", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const describeIntegration = describe.skipIf(!dockerAvailable());

const stubModel = new MockLanguageModelV3({
  provider: "mock",
  modelId: "mock",
  doGenerate: {
    content: [{ type: "text", text: "multi-source ok" }],
    finishReason: "stop",
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    warnings: [],
  },
});

describeIntegration.sequential(
  "@arivie/core defineArivie multi-source (postgres + mock MCP)",
  () => {
    let container: Awaited<ReturnType<PostgreSqlContainer["start"]>>;
    let connectionUrl: string;
    let semanticPath: string;
    const instances: ArivieInstance[] = [];

    beforeAll(async () => {
      container = await new PostgreSqlContainer("postgres:16-alpine").start();
      connectionUrl = container.getConnectionUri();

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

      semanticPath = join(tmpdir(), `arivie-multi-source-${Date.now()}`);
      await mkdir(join(semanticPath, "entities"), { recursive: true });
      await writeFile(join(semanticPath, "entities", ".gitkeep"), "");
    }, 120_000);

    afterEach(async () => {
      while (instances.length > 0) {
        const instance = instances.pop();
        if (instance) {
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
      }
    });

    afterAll(async () => {
      await writeFile(transcriptPath, `${transcriptLines.join("\n")}\n`);
      await new Promise((resolve) => setTimeout(resolve, 500));
      await container.stop();
    });

    it("wires execute_postgres, execute_mock, namespaced MCP tools, and passes assertToolShape", async () => {
      const config = {
        owner: { id: "test-owner", name: "Test" },
        model: stubModel,
        workspace: { rootDir: semanticPath },
        sources: {
          postgres: {
            adapter: postgresAdapter({ url: connectionUrl }),
            description: "Postgres test source.",
          },
          mock: {
            mcp: {
              command: "tsx",
              args: [mockServerPath],
            },
            description: "Mock MCP test source.",
          },
        },
        semantic: { path: semanticPath, mode: "auto" as const },
        resolveUser: async () => ({
          userId: "u1",
          permissions: [] as string[],
          dbRole: "arivie_reader",
        }),
      };

      const coldStartStart = performance.now();
      console.time("defineArivie");
      const instance = await defineArivie(config);
      console.timeEnd("defineArivie");
      instances.push(instance);

      const coldStartMs = performance.now() - coldStartStart;
      log(`defineArivie cold-start: ${coldStartMs.toFixed(1)}ms`);
      if (coldStartMs > 5000) {
        log("HS-2 trigger: cold-start exceeded 5s budget");
      }
      const tools = await instance.agent.listTools();
      const toolNames = Object.keys(tools).sort();

      log(`agent tool keys (${toolNames.length}): ${toolNames.join(", ")}`);

      expect(tools).toHaveProperty("execute_postgres");
      expect(tools).toHaveProperty("execute_mock");
      expect(tools).toHaveProperty("mock_query");
      expect(tools).toHaveProperty("mock_introspect");
      expect(tools).toHaveProperty("mock_count");

      expect(instance.workspace).toBeDefined();
      const workspaceTools = toolNames.filter((n) =>
        n.startsWith("mastra_workspace_"),
      );
      log(
        workspaceTools.length > 0
          ? `mastra_workspace_* in listTools: ${workspaceTools.join(", ")}`
          : "mastra_workspace_* auto-injected by Mastra at runtime (REQ-53.d; not in listTools at boot)",
      );

      expect(() =>
        assertToolShape({
          tools,
          config: {
            compile_metric: false,
            workspace: { finalizeReport: false },
          },
          sourceNames: ["postgres", "mock"],
          workspace: instance.workspace,
        }),
      ).not.toThrow();

      log("assertToolShape: passed for postgres + mock");

      const user = {
        userId: "u1",
        permissions: [] as string[],
        dbRole: "arivie_reader",
      };
      const executeMock = tools.execute_mock;
      expect(executeMock?.execute).toBeTypeOf("function");

      const mcpResult = await runWithUserContext(user, () =>
        executeMock!.execute!(
          { toolName: "mock_query", args: {} },
          {},
        ),
      );
      expect(mcpResult.rowCount).toBeGreaterThanOrEqual(1);
      expect(mcpResult.rows[0]).toMatchObject({
        tool: "mock_query",
        ok: true,
      });
      log("execute_mock invocation: ok");
    }, 120_000);

    it("dispose closes MCP child process", async () => {
      const config = {
        owner: { id: "test-owner", name: "Test" },
        model: stubModel,
        workspace: { rootDir: semanticPath },
        sources: {
          postgres: {
            adapter: postgresAdapter({ url: connectionUrl }),
            description: "Postgres test source.",
          },
          mock: {
            mcp: {
              command: "tsx",
              args: [mockServerPath],
            },
            description: "Mock MCP test source.",
          },
        },
        semantic: { path: semanticPath, mode: "auto" as const },
        resolveUser: async () => ({
          userId: "u1",
          permissions: [] as string[],
          dbRole: "arivie_reader",
        }),
      };

      const instance = await defineArivie(config);
      instances.push(instance);

      const { execSync } = await import("node:child_process");
      const before = execSync("pgrep -f mock-server.ts || true", {
        encoding: "utf8",
      })
        .trim()
        .split("\n")
        .filter((line) => line.length > 0);

      await instance.dispose();

      await new Promise((resolve) => setTimeout(resolve, 500));

      const after = execSync("pgrep -f mock-server.ts || true", {
        encoding: "utf8",
      })
        .trim()
        .split("\n")
        .filter((line) => line.length > 0);

      for (const pid of before) {
        expect(after).not.toContain(pid);
      }
      log(`dispose: MCP child processes cleaned (${before.length} before)`);
    }, 120_000);
  },
);
