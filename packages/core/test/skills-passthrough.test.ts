/* SPDX-License-Identifier: Apache-2.0 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PostgresAdapter } from "@arivie/db-postgres";
import { InProcessSandboxFilesystem } from "@arivie/workspace";
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

const EXPECTED_SKILL_NAMES = [
  "cohort-analysis",
  "funnel-conversion",
  "churn-investigation",
  "revenue-attribution",
  "anomaly-detection",
  "dau-mau-ratio",
] as const;

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

describe("defineArivie workspace.skills passthrough (v02-S3-02)", () => {
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
    sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), "arivie-skills-passthrough-"));
    return new InProcessSandboxFilesystem({ rootDir: sandboxRoot });
  }

  it("exposes six skills when workspace.skills points at @arivie/skills", async () => {
    const filesystem = await sandboxFilesystem();
    const instance = await track(
      await defineArivie({
        owner: { id: "owner-skills", name: "Skills Passthrough" },
        model: stubModel,
        workspace: { filesystem },
        skills: [skillsPackagePath],
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

    const listed = await instance.workspace.skills?.list();
    expect(listed?.length).toBe(6);
    for (const name of EXPECTED_SKILL_NAMES) {
      expect(listed?.map((s) => s.name)).toContain(name);
    }
  });

  it("accepts workspace.skills as a single string path", async () => {
    const filesystem = await sandboxFilesystem();
    const instance = await track(
      await defineArivie({
        owner: { id: "owner-skills-str", name: "Skills String" },
        model: stubModel,
        workspace: { filesystem },
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

    const listed = await instance.workspace.skills?.list();
    expect(listed?.length).toBe(6);
  });

  it("has zero skills when workspace.skills is omitted", async () => {
    const filesystem = await sandboxFilesystem();
    const instance = await track(
      await defineArivie({
        owner: { id: "owner-no-skills", name: "No Skills" },
        model: stubModel,
        workspace: { filesystem },
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

    const listed = await instance.workspace.skills?.list();
    expect(listed?.length ?? 0).toBe(0);
  });
});
