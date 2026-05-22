/* SPDX-License-Identifier: Apache-2.0 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SemanticLayerFilesystem } from "../src/filesystem.js";
import { confineRealPath, resolveWithinRoot } from "../src/path-guard.js";

describe("resolveWithinRoot", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "arivie-path-guard-"));
  });

  afterEach(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it("resolves a valid relative path under root", () => {
    const resolved = resolveWithinRoot(rootDir, "entities/orders.yml");
    expect(resolved).toBe(path.resolve(rootDir, "entities/orders.yml"));
  });

  it("rejects ../etc/passwd traversal", () => {
    expect(() => resolveWithinRoot(rootDir, "../etc/passwd")).toThrow(
      "path traversal rejected: ../etc/passwd",
    );
  });

  it("rejects .. alone (root escape)", () => {
    expect(() => resolveWithinRoot(rootDir, "..")).toThrow(
      "path traversal rejected: ..",
    );
  });

  it("rejects absolute paths outside root", () => {
    expect(() => resolveWithinRoot(rootDir, "/etc/passwd")).toThrow(
      /path traversal rejected/,
    );
  });

  it("allows the root itself", () => {
    const resolved = resolveWithinRoot(rootDir, ".");
    expect(resolved).toBe(path.resolve(rootDir));
  });
});

describe("confineRealPath / symlink escape", () => {
  let rootDir: string;
  let outsideDir: string;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "arivie-symlink-"));
    outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "arivie-outside-"));
    await fs.writeFile(path.join(outsideDir, "secret.txt"), "leaked\n");
    await fs.symlink(outsideDir, path.join(rootDir, "link-out"));
  });

  afterEach(async () => {
    await fs.rm(outsideDir, { recursive: true, force: true });
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it("rejects read through symlink pointing outside root", async () => {
    const fsLayer = new SemanticLayerFilesystem({ rootDir });
    await expect(
      fsLayer.readFile(path.join("link-out", "secret.txt"), { encoding: "utf8" }),
    ).rejects.toThrow(/path traversal rejected/);
  });

  it("confineRealPath rejects resolved symlink target", async () => {
    const absolute = path.resolve(rootDir, "link-out", "secret.txt");
    await expect(confineRealPath(rootDir, absolute)).rejects.toThrow(
      /path traversal rejected/,
    );
  });
});
