/* SPDX-License-Identifier: Apache-2.0 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertToolShape } from "@arivie/agent";
import type { PostgresAdapter } from "@arivie/db-postgres";
import {
  InProcessSandboxFilesystem,
  VercelSandboxFilesystem,
  hasVercelBenchCreds,
} from "@arivie/workspace";
import { readFileTool } from "@mastra/core/workspace";
import { MockLanguageModelV3 } from "ai/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineArivie } from "../src/define.js";
import type { ArivieInstance } from "../src/types.js";

vi.mock("@mastra/pg", () => ({
  PostgresStore: class MockPostgresStore {
    __setLogger = (): void => {};
    init = async (): Promise<void> => {};
    close = async (): Promise<void> => {};
  },
}));

const sem5FixturePath = path.join(
  fileURLToPath(new URL("../../agent/test/fixtures/sem-5", import.meta.url)),
);
const skillsPackagePath = path.join(
  fileURLToPath(new URL("../../skills", import.meta.url)),
);

const stubModel = new MockLanguageModelV3({
  provider: "mock",
  modelId: "mock",
  doGenerate: {
    content: [{ type: "text", text: "ok" }],
    finishReason: "stop",
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    warnings: [],
  },
});

function mockPostgres(): PostgresAdapter {
  return {
    kind: "postgres",
    id: "postgres:test",
    url: "postgres://localhost/arivie",
    sql: {} as PostgresAdapter["sql"],
    execute: async () => ({
      rows: [],
      rowCount: 0,
      durationMs: 0,
      truncated: false,
    }),
    introspect: async () => [],
    verifyOwnerIdentity: async () => {},
    setupRole: async () => {},
  };
}

async function readViaMastraWorkspaceTool(
  workspace: ArivieInstance["workspace"],
  filePath: string,
): Promise<string> {
  const result = await readFileTool.execute!(
    { path: filePath },
    { workspace } as Parameters<NonNullable<typeof readFileTool.execute>>[1],
  );
  if (typeof result === "string") {
    return result;
  }
  if (
    result != null &&
    typeof result === "object" &&
    "text" in result &&
    typeof (result as { text: unknown }).text === "string"
  ) {
    return (result as { text: string }).text;
  }
  return String(result);
}

describe("defineArivie sandboxed workspace (v02-S2-04)", () => {
  const instances: ArivieInstance[] = [];
  let sandboxRoot: string;

  afterEach(async () => {
    while (instances.length > 0) {
      const instance = instances.pop();
      if (instance) {
        await instance.dispose();
      }
    }
    if (sandboxRoot) {
      await fs.rm(sandboxRoot, { recursive: true, force: true }).catch(() => {});
    }
  });

  async function track(instance: ArivieInstance): Promise<ArivieInstance> {
    instances.push(instance);
    return instance;
  }

  async function sandboxFilesystem(): Promise<InProcessSandboxFilesystem> {
    sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), "arivie-sbx-define-"));
    return new InProcessSandboxFilesystem({ rootDir: sandboxRoot });
  }

  it("constructs with sandbox filesystem, uploads sem-5, and reads orders via mastra_workspace_read_file", async () => {
    const filesystem = await sandboxFilesystem();
    const instance = await track(
      await defineArivie({
        owner: { id: "owner-sbx", name: "Sandbox Test" },
        model: stubModel,
        workspace: {
          filesystem,
          finalizeReport: true,
        },
        skills: skillsPackagePath,
        storage: mockPostgres(),
        sources: {
          postgres: { kind: "adapter", adapter: mockPostgres(), description: "Test source." },
        },
        semantic: { path: sem5FixturePath, mode: "preload" },
        resolveUser: async () => ({
          userId: "u1",
          permissions: [],
          dbRole: "arivie_reader",
        }),
      }),
    );

    const tools = await instance.agent.listTools();
    expect(tools).toHaveProperty("execute_postgres");
    expect(tools).toHaveProperty("finalize_report");
    expect(tools.finalize_report.id).toBe("finalize_report");
    expect(tools).not.toHaveProperty("workspace_bash");

    assertToolShape({
      tools,
      config: { compile_metric: false, workspace: { finalizeReport: true } },
      sourceNames: ["postgres"],
      workspace: instance.workspace,
    });

    const content = await readViaMastraWorkspaceTool(
      instance.workspace,
      "entities/orders.yml",
    );
    expect(content).toContain("name: orders");
    expect(content).toContain("grain: one row per order");
    expect(content).toContain("revenue");
    expect(content).toMatch(/entities\/orders\.yml/);
  });

  it("registers workspace_bash when workspace.tools includes bash", async () => {
    const filesystem = await sandboxFilesystem();
    const instance = await track(
      await defineArivie({
        owner: { id: "owner-bash", name: "Bash Test" },
        model: stubModel,
        workspace: {
          filesystem,
          finalizeReport: true,
          bash: true,
        },
        storage: mockPostgres(),
        sources: {
          postgres: { kind: "adapter", adapter: mockPostgres(), description: "Test source." },
        },
        semantic: { path: sem5FixturePath, mode: "preload" },
        resolveUser: async () => ({
          userId: "u1",
          permissions: [],
          dbRole: "arivie_reader",
        }),
      }),
    );

    const tools = await instance.agent.listTools();
    expect(tools).toHaveProperty("workspace_bash");
    expect(tools.workspace_bash.id).toBe("workspace_bash");
  });
});

describe.skipIf(!hasVercelBenchCreds())(
  "defineArivie VercelSandboxFilesystem (live creds)",
  () => {
    const instances: ArivieInstance[] = [];

    afterEach(async () => {
      while (instances.length > 0) {
        const instance = instances.pop();
        if (instance) {
          await instance.dispose();
          const fs = instance.workspace.filesystem;
          if (
            fs != null &&
            "stop" in fs &&
            typeof fs.stop === "function"
          ) {
            await fs.stop().catch(() => undefined);
          }
        }
      }
    });

    it("provisions sandbox, uploads sem-5, and reads orders.yml", async () => {
      const filesystem = new VercelSandboxFilesystem({
        network: { egress: false },
      });
      const instance = await defineArivie({
        owner: { id: "owner-vercel", name: "Vercel Sandbox" },
        model: stubModel,
        workspace: {
          filesystem,
          finalizeReport: true,
        },
        skills: skillsPackagePath,
        storage: mockPostgres(),
        sources: {
          postgres: { kind: "adapter", adapter: mockPostgres(), description: "Test source." },
        },
        semantic: { path: sem5FixturePath, mode: "preload" },
        resolveUser: async () => ({
          userId: "u1",
          permissions: [],
          dbRole: "arivie_reader",
        }),
      });
      instances.push(instance);

      const tools = await instance.agent.listTools();
      expect(tools).toHaveProperty("finalize_report");
      expect(tools).not.toHaveProperty("workspace_bash");

      const content = await readViaMastraWorkspaceTool(
        instance.workspace,
        "entities/orders.yml",
      );
      expect(content).toContain("name: orders");
      expect(content).toMatch(/entities\/orders\.yml/);
    }, 120_000);
  },
);
