/* SPDX-License-Identifier: Apache-2.0 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_DOCKER_SANDBOX_BASE } from "../../src/filesystems/shared.js";
import { DockerSandboxFilesystem } from "../../src/filesystems/docker.js";
import { runFilesystemContract } from "./contract.js";
import { createMockDockerode } from "./dockerode-mock.js";
import { createLocalBackedDockerClient } from "./mock-session.js";

const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/sandbox-rootDir",
);

describe("DockerSandboxFilesystem contract", () => {
  let hostRoot: string;

  beforeEach(async () => {
    hostRoot = await fs.mkdtemp(path.join(os.tmpdir(), "arivie-docker-"));
    const sandboxTree = path.join(hostRoot, "tree");
    await fs.mkdir(sandboxTree, { recursive: true });
    await fs.cp(fixturesDir, sandboxTree, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(hostRoot, { recursive: true, force: true });
  });

  runFilesystemContract(async () => {
    const client = createLocalBackedDockerClient(
      path.join(hostRoot, "tree"),
      DEFAULT_DOCKER_SANDBOX_BASE,
    );
    return new DockerSandboxFilesystem({ client });
  });
});

describe("DockerSandboxFilesystem", () => {
  let hostRoot: string;

  beforeEach(async () => {
    hostRoot = await fs.mkdtemp(path.join(os.tmpdir(), "arivie-docker-"));
    const sandboxTree = path.join(hostRoot, "tree");
    await fs.mkdir(sandboxTree, { recursive: true });
    await fs.cp(fixturesDir, sandboxTree, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(hostRoot, { recursive: true, force: true });
  });

  it("exposes kind docker", async () => {
    const client = createLocalBackedDockerClient(
      path.join(hostRoot, "tree"),
      DEFAULT_DOCKER_SANDBOX_BASE,
    );
    const fs = new DockerSandboxFilesystem({ client });
    expect(fs.kind).toBe("docker");
  });

  it("routes readFile through the injected client", async () => {
    const client = createLocalBackedDockerClient(
      path.join(hostRoot, "tree"),
      DEFAULT_DOCKER_SANDBOX_BASE,
    );
    const readSpy = vi.spyOn(client, "readFile");
    const filesystem = new DockerSandboxFilesystem({ client });
    await filesystem.readFile("catalog.yml", { encoding: "utf8" });
    expect(readSpy).toHaveBeenCalledWith(
      `${DEFAULT_DOCKER_SANDBOX_BASE}/catalog.yml`,
      { encoding: "utf8" },
    );
  });

  it("uploadFromHost delegates to client.putFile", async () => {
    const client = createLocalBackedDockerClient(
      path.join(hostRoot, "tree"),
      DEFAULT_DOCKER_SANDBOX_BASE,
    );
    const putSpy = vi.spyOn(client, "putFile");
    const filesystem = new DockerSandboxFilesystem({ client });
    const hostFile = path.join(hostRoot, "source.txt");
    await fs.writeFile(hostFile, "docker-upload");
    await filesystem.uploadFromHost(hostFile, "uploads/source.txt");
    expect(putSpy).toHaveBeenCalled();
    const written = await filesystem.readFile("uploads/source.txt", {
      encoding: "utf8",
    });
    expect(written).toBe("docker-upload");
  });

  it("requires client or docker + containerId", async () => {
    const filesystem = new DockerSandboxFilesystem();
    await expect(filesystem.readFile("catalog.yml")).rejects.toThrow(
      /requires client or docker/,
    );
  });

  it("dockerode client readFile uses container exec", async () => {
    const { docker, exec } = createMockDockerode();
    const filesystem = new DockerSandboxFilesystem({
      docker,
      containerId: "container-1",
      basePath: DEFAULT_DOCKER_SANDBOX_BASE,
    });
    const content = await filesystem.readFile("catalog.yml", {
      encoding: "utf8",
    });
    expect(content).toBe("file-content");
    expect(exec).toHaveBeenCalled();
  });

  it("dockerode client exists returns true on exit 0", async () => {
    const { docker } = createMockDockerode();
    const filesystem = new DockerSandboxFilesystem({
      docker,
      containerId: "container-1",
      basePath: DEFAULT_DOCKER_SANDBOX_BASE,
    });
    await expect(filesystem.exists("catalog.yml")).resolves.toBe(true);
  });

  it("dockerode client readdir parses find output", async () => {
    const { docker } = createMockDockerode();
    const filesystem = new DockerSandboxFilesystem({
      docker,
      containerId: "container-1",
      basePath: DEFAULT_DOCKER_SANDBOX_BASE,
    });
    const entries = await filesystem.readdir("entities");
    expect(entries.length).toBeGreaterThan(0);
  });

  it("dockerode client stat maps stat output", async () => {
    const { docker } = createMockDockerode();
    const filesystem = new DockerSandboxFilesystem({
      docker,
      containerId: "container-1",
      basePath: DEFAULT_DOCKER_SANDBOX_BASE,
    });
    const fileStat = await filesystem.stat("catalog.yml");
    expect(fileStat.size).toBe(12);
    expect(fileStat.type).toBe("file");
  });

  it("dockerode client uploadFromHost uses tee", async () => {
    const { docker, exec } = createMockDockerode();
    const filesystem = new DockerSandboxFilesystem({
      docker,
      containerId: "container-1",
      basePath: DEFAULT_DOCKER_SANDBOX_BASE,
    });
    const hostFile = path.join(hostRoot, "tee-source.txt");
    await fs.writeFile(hostFile, "tee-content");
    await filesystem.uploadFromHost(hostFile, "uploads/tee-source.txt");
    expect(exec).toHaveBeenCalled();
  });

  it("stop is a no-op when client has no stop hook", async () => {
    const client = createLocalBackedDockerClient(
      path.join(hostRoot, "tree"),
      DEFAULT_DOCKER_SANDBOX_BASE,
    );
    const filesystem = new DockerSandboxFilesystem({ client });
    await filesystem.stop();
    expect(filesystem.status).toBe("stopped");
  });
});
