/* SPDX-License-Identifier: Apache-2.0 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SemanticLayerFilesystem } from "../../src/filesystem.js";
import { DockerSandboxFilesystem } from "../../src/filesystems/docker.js";
import { InProcessSandboxFilesystem } from "../../src/filesystems/in-process.js";
import { VercelSandboxFilesystem } from "../../src/filesystems/vercel.js";
import { makeWorkspace } from "../../src/make-workspace.js";
import { workspaceBashTool } from "../../src/tools/bash.js";
import { createLocalBackedDockerClient } from "../filesystems/mock-session.js";
import { createLocalBackedVercelSession } from "../filesystems/mock-session.js";
import { DEFAULT_DOCKER_SANDBOX_BASE, DEFAULT_VERCEL_SANDBOX_BASE } from "../../src/filesystems/shared.js";

describe("workspaceBashTool", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "arivie-bash-tool-"));
  });

  afterEach(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it("exposes id workspace_bash and argv input schema", () => {
    const filesystem = new InProcessSandboxFilesystem({ rootDir });
    const tool = workspaceBashTool({ filesystem });
    expect(tool.id).toBe("workspace_bash");
  });

  it("runs allowlisted commands via in-process runCommand", async () => {
    await fs.writeFile(path.join(rootDir, "probe.txt"), "hello");
    const filesystem = new InProcessSandboxFilesystem({ rootDir });
    const tool = workspaceBashTool({ filesystem });
    const result = await tool.execute!({ argv: ["cat", "probe.txt"] }, {});

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("hello");
    expect(typeof result.stderr).toBe("string");
  });

  it("rejects shell metacharacters through in-process runCommand", async () => {
    const filesystem = new InProcessSandboxFilesystem({ rootDir });
    const tool = workspaceBashTool({ filesystem });
    await expect(
      tool.execute!({ argv: ["ls", ";", "rm", "-rf", "/"] }, {}),
    ).rejects.toThrow(/metacharacter/);
  });
});

describe("makeWorkspace workspace_bash", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "arivie-bash-mw-"));
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("does not return bashTool without tools opt-in", async () => {
    const sandboxRoot = path.join(tempRoot, "sandbox");
    await fs.mkdir(sandboxRoot, { recursive: true });
    const filesystem = new InProcessSandboxFilesystem({ rootDir: sandboxRoot });
    const { bashEnabled, bashTool } = await makeWorkspace({
      filesystem,
    });
    expect(bashEnabled).toBe(false);
    expect(bashTool).toBeUndefined();
  });

  it("returns bashTool when tools includes bash on sandboxed filesystem", async () => {
    const sandboxRoot = path.join(tempRoot, "sandbox");
    await fs.mkdir(sandboxRoot, { recursive: true });
    const filesystem = new InProcessSandboxFilesystem({ rootDir: sandboxRoot });
    const { bashEnabled, bashTool } = await makeWorkspace({
      filesystem,
      tools: ["bash"],
    });
    expect(bashEnabled).toBe(true);
    expect(bashTool).toBeDefined();
    expect(bashTool!.id).toBe("workspace_bash");
  });

  it("does not return bashTool on local filesystem", async () => {
    const localRoot = path.join(tempRoot, "local");
    await fs.mkdir(localRoot, { recursive: true });
    const { bashTool } = await makeWorkspace({
      rootDir: localRoot,
    });
    expect(bashTool).toBeUndefined();
  });
});

describe("workspace_bash sandbox routing", () => {
  let hostRoot: string;

  beforeEach(async () => {
    hostRoot = await fs.mkdtemp(path.join(os.tmpdir(), "arivie-bash-route-"));
    const sandboxTree = path.join(hostRoot, "tree");
    await fs.mkdir(sandboxTree, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(hostRoot, { recursive: true, force: true });
  });

  it("routes VercelSandboxFilesystem through session runCommand", async () => {
    const session = createLocalBackedVercelSession(
      path.join(hostRoot, "tree"),
      DEFAULT_VERCEL_SANDBOX_BASE,
    );
    const runCommand = vi.fn().mockResolvedValue({
      stdout: "ok",
      stderr: "",
      exitCode: 0,
    });
    session.runCommand = runCommand;

    const filesystem = new VercelSandboxFilesystem({ session });
    const tool = workspaceBashTool({ filesystem });
    const result = await tool.execute!({ argv: ["echo", "hi"] }, {});

    expect(runCommand).toHaveBeenCalledWith(["echo", "hi"], undefined);
    expect(result).toEqual({ stdout: "ok", stderr: "", exitCode: 0 });
  });

  it("routes DockerSandboxFilesystem through client runCommand", async () => {
    const client = createLocalBackedDockerClient(
      path.join(hostRoot, "tree"),
      DEFAULT_DOCKER_SANDBOX_BASE,
    );
    const runCommand = vi.fn().mockResolvedValue({
      stdout: "docker-out",
      stderr: "docker-err",
      exitCode: 2,
    });
    client.runCommand = runCommand;

    const filesystem = new DockerSandboxFilesystem({ client });
    const tool = workspaceBashTool({ filesystem });
    const result = await tool.execute!({ argv: ["pwd"] }, {});

    expect(runCommand).toHaveBeenCalledWith(["pwd"]);
    expect(result).toEqual({
      stdout: "docker-out",
      stderr: "docker-err",
      exitCode: 2,
    });
  });
});

describe("workspace_bash agent registration", () => {
  it("local SemanticLayerFilesystem is not a sandbox runCommand target", () => {
    const filesystem = new SemanticLayerFilesystem({
      rootDir: "/tmp/arivie-local-bash",
    });
    expect(filesystem.kind).toBe("local");
    expect("runCommand" in filesystem).toBe(false);
  });
});
