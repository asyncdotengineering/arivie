/* SPDX-License-Identifier: Apache-2.0 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_VERCEL_SANDBOX_BASE } from "../../src/filesystems/shared.js";
import {
  VercelSandboxFilesystem,
  buildVercelSandboxCreateParams,
  resolveVercelNetworkPolicy,
} from "../../src/filesystems/vercel.js";
import { runFilesystemContract } from "./contract.js";
import { createLocalBackedVercelSession } from "./mock-session.js";

const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/sandbox-rootDir",
);

describe("VercelSandboxFilesystem contract", () => {
  let hostRoot: string;

  beforeEach(async () => {
    hostRoot = await fs.mkdtemp(path.join(os.tmpdir(), "arivie-vercel-"));
    const sandboxTree = path.join(hostRoot, "tree");
    await fs.mkdir(sandboxTree, { recursive: true });
    await fs.cp(fixturesDir, sandboxTree, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(hostRoot, { recursive: true, force: true });
  });

  runFilesystemContract(async () => {
    const session = createLocalBackedVercelSession(
      path.join(hostRoot, "tree"),
      DEFAULT_VERCEL_SANDBOX_BASE,
    );
    return new VercelSandboxFilesystem({ session });
  });
});

describe("VercelSandboxFilesystem", () => {
  let hostRoot: string;

  beforeEach(async () => {
    hostRoot = await fs.mkdtemp(path.join(os.tmpdir(), "arivie-vercel-"));
    const sandboxTree = path.join(hostRoot, "tree");
    await fs.mkdir(sandboxTree, { recursive: true });
    await fs.cp(fixturesDir, sandboxTree, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(hostRoot, { recursive: true, force: true });
  });

  it("exposes kind vercel", async () => {
    const session = createLocalBackedVercelSession(
      path.join(hostRoot, "tree"),
      DEFAULT_VERCEL_SANDBOX_BASE,
    );
    const fs = new VercelSandboxFilesystem({ session });
    expect(fs.kind).toBe("vercel");
  });

  it("routes readFile through the injected session", async () => {
    const session = createLocalBackedVercelSession(
      path.join(hostRoot, "tree"),
      DEFAULT_VERCEL_SANDBOX_BASE,
    );
    const readSpy = vi.spyOn(session.fs, "readFile");
    const filesystem = new VercelSandboxFilesystem({ session });
    await filesystem.readFile("catalog.yml", { encoding: "utf8" });
    expect(readSpy).toHaveBeenCalledWith(
      `${DEFAULT_VERCEL_SANDBOX_BASE}/catalog.yml`,
      { encoding: "utf8" },
    );
  });

  it("stop delegates to session.stop", async () => {
    const session = createLocalBackedVercelSession(
      path.join(hostRoot, "tree"),
      DEFAULT_VERCEL_SANDBOX_BASE,
    );
    const stop = vi.fn().mockResolvedValue(undefined);
    session.stop = stop;
    const filesystem = new VercelSandboxFilesystem({ session });
    await filesystem.stop();
    expect(stop).toHaveBeenCalled();
    expect(filesystem.status).toBe("stopped");
  });

  it("uploadAtCreate runs on construction", async () => {
    const hostFile = path.join(hostRoot, "at-create.txt");
    await fs.writeFile(hostFile, "at-create");
    const session = createLocalBackedVercelSession(
      path.join(hostRoot, "tree"),
      DEFAULT_VERCEL_SANDBOX_BASE,
    );
    const filesystem = new VercelSandboxFilesystem({
      session,
      uploadAtCreate: { [hostFile]: "created/at-create.txt" },
    });
    const content = await filesystem.readFile("created/at-create.txt", {
      encoding: "utf8",
    });
    expect(content).toBe("at-create");
  });

  it("uploadFromHost copies directories", async () => {
    const session = createLocalBackedVercelSession(
      path.join(hostRoot, "tree"),
      DEFAULT_VERCEL_SANDBOX_BASE,
    );
    const filesystem = new VercelSandboxFilesystem({ session });
    await filesystem.uploadFromHost(fixturesDir, "semantic");
    const content = await filesystem.readFile("semantic/catalog.yml", {
      encoding: "utf8",
    });
    expect(content).toContain("sandbox-catalog");
  });

  it("readdir filters by extension", async () => {
    const session = createLocalBackedVercelSession(
      path.join(hostRoot, "tree"),
      DEFAULT_VERCEL_SANDBOX_BASE,
    );
    const filesystem = new VercelSandboxFilesystem({ session });
    const entries = await filesystem.readdir("entities", { extension: ".yml" });
    expect(entries.every((e) => e.type === "directory" || e.name.endsWith(".yml"))).toBe(
      true,
    );
  });

  it("defaults network egress to disabled (deny-all)", () => {
    expect(resolveVercelNetworkPolicy()).toBe("deny-all");
    expect(resolveVercelNetworkPolicy({})).toBe("deny-all");
    expect(resolveVercelNetworkPolicy({ egress: false })).toBe("deny-all");
    expect(buildVercelSandboxCreateParams({}).networkPolicy).toBe("deny-all");
  });

  it("maps network egress true to allow-all in sandbox create params", () => {
    expect(resolveVercelNetworkPolicy({ egress: true })).toBe("allow-all");
    expect(
      buildVercelSandboxCreateParams({ network: { egress: true } })
        .networkPolicy,
    ).toBe("allow-all");
  });

  it("constructor does not throw without credentials (lazy spin-up)", () => {
    expect(() => new VercelSandboxFilesystem()).not.toThrow();
  });

  it("rejects missing credentials on first use with a clear error", async () => {
    const saved = {
      VERCEL_TOKEN: process.env.VERCEL_TOKEN,
      VERCEL_TEAM_ID: process.env.VERCEL_TEAM_ID,
      VERCEL_PROJECT_ID: process.env.VERCEL_PROJECT_ID,
    };
    delete process.env.VERCEL_TOKEN;
    delete process.env.VERCEL_TEAM_ID;
    delete process.env.VERCEL_PROJECT_ID;
    try {
      const filesystem = new VercelSandboxFilesystem();
      await expect(
        filesystem.readFile("catalog.yml", { encoding: "utf8" }),
      ).rejects.toThrow(/VERCEL_TOKEN/);
    } finally {
      if (saved.VERCEL_TOKEN !== undefined) {
        process.env.VERCEL_TOKEN = saved.VERCEL_TOKEN;
      }
      if (saved.VERCEL_TEAM_ID !== undefined) {
        process.env.VERCEL_TEAM_ID = saved.VERCEL_TEAM_ID;
      }
      if (saved.VERCEL_PROJECT_ID !== undefined) {
        process.env.VERCEL_PROJECT_ID = saved.VERCEL_PROJECT_ID;
      }
    }
  });

  it("uploadFromHost writes through session.writeFiles", async () => {
    const session = createLocalBackedVercelSession(
      path.join(hostRoot, "tree"),
      DEFAULT_VERCEL_SANDBOX_BASE,
    );
    const writeSpy = vi.spyOn(session, "writeFiles");
    const filesystem = new VercelSandboxFilesystem({ session });
    const hostFile = path.join(hostRoot, "source.txt");
    await fs.writeFile(hostFile, "from-host");
    await filesystem.uploadFromHost(
      hostFile,
      "uploads/source.txt",
    );
    expect(writeSpy).toHaveBeenCalled();
    const written = await filesystem.readFile("uploads/source.txt", {
      encoding: "utf8",
    });
    expect(written).toBe("from-host");
  });
});
