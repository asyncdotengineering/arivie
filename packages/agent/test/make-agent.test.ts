/* SPDX-License-Identifier: Apache-2.0 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SemanticLayer } from "@arivie/semantic";
import type { PostgresAdapter } from "@arivie/db-postgres";
import {
  InProcessSandboxFilesystem,
  makeWorkspace,
} from "@arivie/workspace";
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { assertToolShape } from "../src/contract-invariants.js";
import { makeAgent, normalizeRequireToolApproval } from "../src/make-agent.js";

function emptySemantic(): SemanticLayer {
  return {
    entities: new Map(),
    catalog: {
      entities: [],
      generated_at: "2026-01-01T00:00:00.000Z",
      source_files: [],
    },
  };
}

function mockDb(id = "postgres:test"): PostgresAdapter {
  return {
    kind: "postgres",
    id,
    url: "postgres://test",
    sql: {} as PostgresAdapter["sql"],
    execute: async () => ({
      rows: [],
      rowCount: 0,
      truncated: false,
      durationMs: 0,
    }),
    introspect: async () => [],
    verifyOwnerIdentity: async () => {},
    setupRole: async () => {},
  };
}

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

describe("makeAgent", () => {
  it("registers execute_postgres and satisfies REQ-53 via assertToolShape", async () => {
    const { workspace } = await makeWorkspace({
      rootDir: "/tmp/arivie-make-agent-test",
    });
    const agent = makeAgent({
      ownerId: "owner-1",
      model: stubModel,
      semantic: emptySemantic(),

      sources: { postgres: mockDb() },
      workspace,
      limits: {},
      config: { compile_metric: false, workspace: { finalizeReport: false } },
    });

    const tools = await agent.listTools();
    expect(tools).toHaveProperty("execute_postgres");
    expect(tools.execute_postgres.id).toBe("execute_postgres");
    expect(tools).not.toHaveProperty("explore");
    expect(tools).not.toHaveProperty("execute");

    assertToolShape({
      tools,
      config: { compile_metric: false, workspace: { finalizeReport: false } },
      sourceNames: ["postgres"],
      workspace,
    });
  });

  it("registers compile_metric when compileMetric is true", async () => {
    const { workspace } = await makeWorkspace({
      rootDir: "/tmp/arivie-make-agent-test",
    });
    const agent = makeAgent({
      ownerId: "owner-1",
      model: stubModel,
      semantic: emptySemantic(),

      sources: { postgres: mockDb() },
      workspace,
      compileMetric: true,
      config: { compile_metric: true, workspace: { finalizeReport: false } },
    });

    const tools = await agent.listTools();
    expect(tools).toHaveProperty("compile_metric");

    assertToolShape({
      tools,
      config: { compile_metric: true, workspace: { finalizeReport: false } },
      sourceNames: ["postgres"],
      workspace,
    });
  });

  it("registers execute_postgres and execute_foo for multiple sources", async () => {
    const { workspace } = await makeWorkspace({
      rootDir: "/tmp/arivie-make-agent-multi",
    });
    const agent = makeAgent({
      ownerId: "owner-1",
      model: stubModel,
      semantic: emptySemantic(),

      sources: {
        postgres: mockDb("postgres:main"),
        foo: mockDb("postgres:foo"),
      },
      workspace,
      limits: {},
      config: { compile_metric: false, workspace: { finalizeReport: false } },
    });

    const tools = await agent.listTools();
    expect(tools).toHaveProperty("execute_postgres");
    expect(tools).toHaveProperty("execute_foo");

    assertToolShape({
      tools,
      config: { compile_metric: false, workspace: { finalizeReport: false } },
      sourceNames: ["postgres", "foo"],
      workspace,
    });
  });

  it("sandboxed workspace passes assertToolShape with finalizeReport false", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "arivie-agent-sbx-"));
    const filesystem = new InProcessSandboxFilesystem({ rootDir });
    const { workspace } = await makeWorkspace({ filesystem });
    const agent = makeAgent({
      ownerId: "owner-1",
      model: stubModel,
      semantic: emptySemantic(),

      sources: { postgres: mockDb() },
      workspace,
      limits: {},
      config: { compile_metric: false, workspace: { finalizeReport: false } },
    });

    const tools = await agent.listTools();
    expect(tools).not.toHaveProperty("finalize_report");
    assertToolShape({
      tools,
      config: { compile_metric: false, workspace: { finalizeReport: false } },
      sourceNames: ["postgres"],
      workspace,
    });
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it("registers finalize_report on sandboxed workspace when finalizeReport is enabled", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "arivie-agent-sbx-"));
    const filesystem = new InProcessSandboxFilesystem({ rootDir });
    const { workspace } = await makeWorkspace({ filesystem });
    const agent = makeAgent({
      ownerId: "owner-1",
      model: stubModel,
      semantic: emptySemantic(),

      sources: { postgres: mockDb() },
      workspace,
      limits: {},
      config: { compile_metric: false, workspace: { finalizeReport: true } },
    });

    const tools = await agent.listTools();
    expect(tools).toHaveProperty("finalize_report");
    expect(tools.finalize_report.id).toBe("finalize_report");
    assertToolShape({
      tools,
      config: { compile_metric: false, workspace: { finalizeReport: true } },
      sourceNames: ["postgres"],
      workspace,
    });
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it("registers workspace_bash when bashTool is provided", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "arivie-agent-bash-"));
    const filesystem = new InProcessSandboxFilesystem({ rootDir });
    const { workspace, bashTool } = await makeWorkspace({
      filesystem,
      tools: ["bash"],
    });
    const agent = makeAgent({
      ownerId: "owner-1",
      model: stubModel,
      semantic: emptySemantic(),

      sources: { postgres: mockDb() },
      workspace,
      bashTool,
      limits: {},
      config: { compile_metric: false, workspace: { finalizeReport: false } },
    });

    const tools = await agent.listTools();
    expect(tools).toHaveProperty("workspace_bash");
    expect(tools.workspace_bash.id).toBe("workspace_bash");
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it("does not register workspace_bash without bashTool", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "arivie-agent-no-bash-"));
    const filesystem = new InProcessSandboxFilesystem({ rootDir });
    const { workspace } = await makeWorkspace({ filesystem });
    const agent = makeAgent({
      ownerId: "owner-1",
      model: stubModel,
      semantic: emptySemantic(),

      sources: { postgres: mockDb() },
      workspace,
      limits: {},
      config: { compile_metric: false, workspace: { finalizeReport: false } },
    });

    const tools = await agent.listTools();
    expect(tools).not.toHaveProperty("workspace_bash");
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it("does not register finalize_report on local workspace", async () => {
    const { workspace } = await makeWorkspace({
      rootDir: "/tmp/arivie-make-agent-local-finalize",
    });
    const agent = makeAgent({
      ownerId: "owner-1",
      model: stubModel,
      semantic: emptySemantic(),

      sources: { postgres: mockDb() },
      workspace,
      limits: {},
      config: { compile_metric: false, workspace: { finalizeReport: true } },
    });

    const tools = await agent.listTools();
    expect(tools).not.toHaveProperty("finalize_report");
  });

  it("attaches skillsProcessor to inputProcessors when provided", async () => {
    const { workspace, skillsProcessor } = await makeWorkspace({
      rootDir: "/tmp/arivie-make-agent-skills-processor",
      skillsMode: "eager",
    });
    const agent = makeAgent({
      ownerId: "owner-1",
      model: stubModel,
      semantic: emptySemantic(),

      sources: { postgres: mockDb() },
      workspace,
      skillsProcessor,
      limits: {},
      config: { compile_metric: false, workspace: { finalizeReport: false } },
    });

    const processors = await agent.listConfiguredInputProcessors();
    expect(processors).toHaveLength(1);
    expect(processors[0]).toBe(skillsProcessor);
  });
});

describe("normalizeRequireToolApproval", () => {
  it("returns undefined for undefined", () => {
    expect(normalizeRequireToolApproval(undefined)).toBeUndefined();
  });

  it("returns undefined for false", () => {
    expect(normalizeRequireToolApproval(false)).toBeUndefined();
  });

  it("returns true for true", () => {
    expect(normalizeRequireToolApproval(true)).toBe(true);
  });

  it("allowlist gates only listed tools", async () => {
    const policy = normalizeRequireToolApproval({ tools: ["execute_postgres", "workspace_bash"] });
    expect(policy).toBeTypeOf("function");
    if (typeof policy !== "function") return;
    expect(await policy({ toolName: "execute_postgres", args: {} })).toBe(true);
    expect(await policy({ toolName: "workspace_bash", args: {} })).toBe(true);
    expect(await policy({ toolName: "compile_metric", args: {} })).toBe(false);
  });

  it("denylist exempts only listed tools", async () => {
    const policy = normalizeRequireToolApproval({ exceptTools: ["compile_metric"] });
    expect(policy).toBeTypeOf("function");
    if (typeof policy !== "function") return;
    expect(await policy({ toolName: "execute_postgres", args: {} })).toBe(true);
    expect(await policy({ toolName: "workspace_bash", args: {} })).toBe(true);
    expect(await policy({ toolName: "compile_metric", args: {} })).toBe(false);
  });

  it("function policy receives toolName and args", async () => {
    const fn = vi.fn((toolName: string) => toolName === "execute_postgres");
    const policy = normalizeRequireToolApproval(fn);
    expect(policy).toBeTypeOf("function");
    if (typeof policy !== "function") return;
    expect(await policy({ toolName: "execute_postgres", args: { sql: "SELECT 1" } })).toBe(true);
    expect(await policy({ toolName: "workspace_bash", args: { argv: ["ls"] } })).toBe(false);
    expect(fn).toHaveBeenCalledWith("execute_postgres", { sql: "SELECT 1" }, undefined);
  });
});
