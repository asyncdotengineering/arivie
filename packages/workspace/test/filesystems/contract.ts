/* SPDX-License-Identifier: Apache-2.0 */
import { expect, it } from "vitest";
import type { WorkspaceFilesystem } from "@mastra/core/workspace";
import { ReadOnlyError } from "../../src/errors.js";

export function runFilesystemContract(
  fsFactory: () => Promise<WorkspaceFilesystem>,
): void {
  it("readFile returns string with encoding", async () => {
    const fs = await fsFactory();
    const content = await fs.readFile("catalog.yml", { encoding: "utf8" });
    expect(typeof content).toBe("string");
    expect(content).toContain("sandbox-catalog");
  });

  it("readFile returns Buffer without encoding", async () => {
    const fs = await fsFactory();
    const content = await fs.readFile("catalog.yml");
    expect(Buffer.isBuffer(content)).toBe(true);
  });

  it("readdir returns FileEntry[]", async () => {
    const fs = await fsFactory();
    const entries = await fs.readdir("entities");
    expect(Array.isArray(entries)).toBe(true);
    expect(entries.length).toBeGreaterThanOrEqual(2);
    expect(entries.every((e) => "name" in e && "type" in e)).toBe(true);
    expect(entries.some((e) => e.name === "orders.yml")).toBe(true);
  });

  it("stat returns FileStat", async () => {
    const fs = await fsFactory();
    const fileStat = await fs.stat("entities/orders.yml");
    expect(fileStat.name).toBe("orders.yml");
    expect(fileStat.type).toBe("file");
    expect(fileStat.size).toBeGreaterThan(0);
    expect(fileStat.modifiedAt).toBeInstanceOf(Date);
  });

  it("exists returns boolean", async () => {
    const fs = await fsFactory();
    await expect(fs.exists("catalog.yml")).resolves.toBe(true);
    await expect(fs.exists("missing.yml")).resolves.toBe(false);
  });

  it.each([
    ["writeFile", (fs: WorkspaceFilesystem) => fs.writeFile("catalog.yml", "x")],
    [
      "appendFile",
      (fs: WorkspaceFilesystem) => fs.appendFile("catalog.yml", "x"),
    ],
    [
      "deleteFile",
      (fs: WorkspaceFilesystem) => fs.deleteFile("catalog.yml"),
    ],
    [
      "copyFile",
      (fs: WorkspaceFilesystem) => fs.copyFile("catalog.yml", "copy.yml"),
    ],
    [
      "moveFile",
      (fs: WorkspaceFilesystem) => fs.moveFile("catalog.yml", "moved.yml"),
    ],
    ["mkdir", (fs: WorkspaceFilesystem) => fs.mkdir("new-dir")],
    ["rmdir", (fs: WorkspaceFilesystem) => fs.rmdir("entities")],
  ] as const)("write path %s throws ReadOnlyError", async (_name, invoke) => {
    const fs = await fsFactory();
    await expect(invoke(fs)).rejects.toBeInstanceOf(ReadOnlyError);
  });

  it("readFile rejects path traversal", async () => {
    const fs = await fsFactory();
    await expect(fs.readFile("../../etc/passwd")).rejects.toThrow(
      /path traversal rejected/,
    );
  });
}
