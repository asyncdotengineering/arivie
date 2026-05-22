/* SPDX-License-Identifier: Apache-2.0 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  InProcessSandboxFilesystem,
  makeWorkspace,
} from "@arivie/workspace";
import { Workspace } from "@mastra/core/workspace";
import { describe, expect, it } from "vitest";
import {
  assertToolShape,
  isMastraWorkspaceToolName,
  isNamespacedMcpToolName,
} from "../src/contract-invariants.js";

describe("isMastraWorkspaceToolName", () => {
  it("matches mastra_workspace_* tools", () => {
    expect(isMastraWorkspaceToolName("mastra_workspace_read_file")).toBe(true);
    expect(isMastraWorkspaceToolName("execute_postgres")).toBe(false);
  });
});

describe("isNamespacedMcpToolName", () => {
  it("matches <source>_<tool> but not execute_<source>", () => {
    expect(isNamespacedMcpToolName("mock_query", ["mock"])).toBe(true);
    expect(isNamespacedMcpToolName("execute_mock", ["mock"])).toBe(false);
    expect(isNamespacedMcpToolName("execute_postgres", ["postgres"])).toBe(false);
  });
});

describe("assertToolShape", () => {
  const localWorkspacePromise = makeWorkspace({
    rootDir: "/tmp/arivie-semantic-test",
  });

  it("passes REQ-53.a–d for a single postgres source (local)", async () => {
    const { workspace } = await localWorkspacePromise;
    const baseConfig = {
      compile_metric: false,
      workspace: { finalizeReport: true },
    } as const;
    expect(() =>
      assertToolShape({
        tools: { execute_postgres: {} },
        config: baseConfig,
        sourceNames: ["postgres"],
        workspace,
      }),
    ).not.toThrow();
  });

  it("ignores namespaced MCP tools for REQ-53.b/c", async () => {
    const { workspace } = await localWorkspacePromise;
    const baseConfig = {
      compile_metric: false,
      workspace: { finalizeReport: true },
    } as const;
    expect(() =>
      assertToolShape({
        tools: {
          execute_postgres: {},
          execute_mock: {},
          mock_query: {},
          mock_introspect: {},
          mock_count: {},
        },
        config: baseConfig,
        sourceNames: ["postgres", "mock"],
        workspace,
      }),
    ).not.toThrow();
  });

  it("ignores mastra_workspace_* tools for REQ-53.a", async () => {
    const { workspace } = await localWorkspacePromise;
    const baseConfig = {
      compile_metric: false,
      workspace: { finalizeReport: true },
    } as const;
    expect(() =>
      assertToolShape({
        tools: {
          execute_postgres: {},
          mastra_workspace_read_file: {},
          mastra_workspace_list_files: {},
        },
        config: baseConfig,
        sourceNames: ["postgres"],
        workspace,
      }),
    ).not.toThrow();
  });

  it("throws REQ-53.a when execute_<source> is missing", async () => {
    const { workspace } = await localWorkspacePromise;
    const baseConfig = {
      compile_metric: false,
      workspace: { finalizeReport: true },
    } as const;
    expect(() =>
      assertToolShape({
        tools: {},
        config: baseConfig,
        sourceNames: ["postgres"],
        workspace,
      }),
    ).toThrow(/REQ-53\.a.*execute_postgres/);
  });

  it("throws REQ-53.b when compile_metric is missing but enabled", async () => {
    const { workspace } = await localWorkspacePromise;
    const baseConfig = {
      compile_metric: false,
      workspace: { finalizeReport: true },
    } as const;
    expect(() =>
      assertToolShape({
        tools: { execute_postgres: {} },
        config: { ...baseConfig, compile_metric: true },
        sourceNames: ["postgres"],
        workspace,
      }),
    ).toThrow(/REQ-53\.b/);
  });

  it("throws REQ-53.b when compile_metric is present but disabled", async () => {
    const { workspace } = await localWorkspacePromise;
    const baseConfig = {
      compile_metric: false,
      workspace: { finalizeReport: true },
    } as const;
    expect(() =>
      assertToolShape({
        tools: { execute_postgres: {}, compile_metric: {} },
        config: baseConfig,
        sourceNames: ["postgres"],
        workspace,
      }),
    ).toThrow(/REQ-53\.b/);
  });

  it("passes REQ-53.c for local filesystem with finalizeReport true", async () => {
    const { workspace } = await localWorkspacePromise;
    expect(() =>
      assertToolShape({
        tools: { execute_postgres: {} },
        config: {
          compile_metric: false,
          workspace: { finalizeReport: true },
        },
        sourceNames: ["postgres"],
        workspace,
      }),
    ).not.toThrow();
  });

  it("passes REQ-53.c for sandboxed workspace when finalizeReport is false", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "arivie-sandbox-"));
    const filesystem = new InProcessSandboxFilesystem({ rootDir });
    const workspace = new Workspace({ filesystem });
    expect(() =>
      assertToolShape({
        tools: { execute_postgres: {} },
        config: {
          compile_metric: false,
          workspace: { finalizeReport: false },
        },
        sourceNames: ["postgres"],
        workspace,
      }),
    ).not.toThrow();
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it("passes REQ-53.c for sandboxed workspace with finalize_report when enabled", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "arivie-sandbox-"));
    const filesystem = new InProcessSandboxFilesystem({ rootDir });
    const workspace = new Workspace({ filesystem });
    expect(() =>
      assertToolShape({
        tools: { execute_postgres: {}, finalize_report: {} },
        config: { compile_metric: false, workspace: {} },
        sourceNames: ["postgres"],
        workspace,
      }),
    ).not.toThrow();
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it("throws REQ-53.c for sandboxed workspace when finalizeReport is enabled but tool missing", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "arivie-sandbox-"));
    const filesystem = new InProcessSandboxFilesystem({ rootDir });
    const workspace = new Workspace({ filesystem });
    expect(() =>
      assertToolShape({
        tools: { execute_postgres: {} },
        config: {
          compile_metric: false,
          workspace: { finalizeReport: true },
        },
        sourceNames: ["postgres"],
        workspace,
      }),
    ).toThrow(/REQ-53\.c/);
    await fs.rm(rootDir, { recursive: true, force: true });
  });
});
