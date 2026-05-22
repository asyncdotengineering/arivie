/* SPDX-License-Identifier: Apache-2.0 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ReadOnlyError,
  SemanticLayerFilesystem,
  makeWorkspace,
} from "../src/index.js";

const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
);

describe("SemanticLayerFilesystem", () => {
  let rootDir: string;
  let filesystem: SemanticLayerFilesystem;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "arivie-workspace-"));
    await fs.cp(fixturesDir, rootDir, { recursive: true });
    filesystem = new SemanticLayerFilesystem({ rootDir });
  });

  afterEach(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it("exposes kind local", () => {
    expect(filesystem.kind).toBe("local");
  });

  it("readFile returns fixture content", async () => {
    const content = await filesystem.readFile("sample.txt", {
      encoding: "utf8",
    });
    expect(content).toBe("arivie workspace fixture\n");
  });

  it("readdir lists directory entries", async () => {
    const entries = await filesystem.readdir("entities");
    expect(entries.map((entry) => entry.name)).toEqual(["orders.yml"]);
    expect(entries[0]?.type).toBe("file");
  });

  it("exists returns true for present files and false otherwise", async () => {
    await expect(filesystem.exists("sample.txt")).resolves.toBe(true);
    await expect(filesystem.exists("nope.txt")).resolves.toBe(false);
  });

  it("stat returns file metadata", async () => {
    const fileStat = await filesystem.stat("sample.txt");
    expect(fileStat.size).toBeGreaterThan(0);
    expect(fileStat.modifiedAt.getTime()).toBeGreaterThan(0);
    expect(fileStat.type).toBe("file");
    expect(fileStat.name).toBe("sample.txt");
  });

  it("stat returns directory type for directories", async () => {
    const dirStat = await filesystem.stat("entities");
    expect(dirStat.type).toBe("directory");
  });

  it.each([
    ["writeFile", () => filesystem.writeFile("sample.txt", "x")],
    ["appendFile", () => filesystem.appendFile("sample.txt", "x")],
    ["deleteFile", () => filesystem.deleteFile("sample.txt")],
    [
      "copyFile",
      () => filesystem.copyFile("sample.txt", "copy.txt"),
    ],
    [
      "moveFile",
      () => filesystem.moveFile("sample.txt", "moved.txt"),
    ],
    ["mkdir", () => filesystem.mkdir("new-dir")],
    ["rmdir", () => filesystem.rmdir("entities")],
  ] as const)("%s throws ReadOnlyError", async (_name, invoke) => {
    await expect(invoke()).rejects.toBeInstanceOf(ReadOnlyError);
  });

  it("readFile rejects path traversal", async () => {
    await expect(filesystem.readFile("../../etc/passwd")).rejects.toThrow(
      /path traversal rejected/,
    );
  });
});

describe("makeWorkspace", () => {
  it("returns a Mastra Workspace with filesystem access", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "arivie-ws-"));
    try {
      await fs.cp(fixturesDir, rootDir, { recursive: true });
      const { workspace } = await makeWorkspace({ rootDir });
      expect(workspace).toBeDefined();
      expect(workspace.filesystem).toBeDefined();
      expect(workspace.filesystem.readOnly).toBe(true);
      const content = await workspace.filesystem.readFile("sample.txt", {
        encoding: "utf8",
      });
      expect(content).toBe("arivie workspace fixture\n");
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });
});
