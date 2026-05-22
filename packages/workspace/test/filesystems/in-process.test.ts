/* SPDX-License-Identifier: Apache-2.0 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  InProcessSandboxFilesystem,
  validateArgv,
} from "../../src/filesystems/in-process.js";
import { runFilesystemContract } from "./contract.js";

const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/sandbox-rootDir",
);

describe("InProcessSandboxFilesystem contract (readOnly mode)", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "arivie-inproc-"));
    await fs.cp(fixturesDir, rootDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  // v0.2: default flipped to writable so the single-agent shape can write
  // file artifacts. The "every write rejects" contract still applies when
  // the caller opts into readOnly: true (e.g. for a `/docs` mount the
  // agent shouldn't mutate).
  runFilesystemContract(
    async () => new InProcessSandboxFilesystem({ rootDir, readOnly: true }),
  );
});

describe("InProcessSandboxFilesystem writable mode (default)", () => {
  let rootDir: string;
  let filesystem: InProcessSandboxFilesystem;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "arivie-inproc-writable-"));
    await fs.cp(fixturesDir, rootDir, { recursive: true });
    filesystem = new InProcessSandboxFilesystem({ rootDir });
  });

  afterEach(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it("reports readOnly false by default", () => {
    expect(filesystem.readOnly).toBe(false);
  });

  it("writeFile creates a new file with content", async () => {
    await filesystem.writeFile("reports/eod.md", "# EOD\nrevenue: 100", {
      encoding: "utf8",
    });
    const written = await fs.readFile(path.join(rootDir, "reports/eod.md"), "utf8");
    expect(written).toBe("# EOD\nrevenue: 100");
  });

  it("writeFile auto-creates parent directories", async () => {
    await filesystem.writeFile("deep/nested/path/file.txt", "hi");
    const written = await fs.readFile(
      path.join(rootDir, "deep/nested/path/file.txt"),
      "utf8",
    );
    expect(written).toBe("hi");
  });

  it("appendFile adds to an existing file", async () => {
    await filesystem.writeFile("log.txt", "line1\n");
    await filesystem.appendFile("log.txt", "line2\n");
    const written = await fs.readFile(path.join(rootDir, "log.txt"), "utf8");
    expect(written).toBe("line1\nline2\n");
  });

  it("mkdir creates a directory (recursive by default)", async () => {
    await filesystem.mkdir("a/b/c");
    const stat = await fs.stat(path.join(rootDir, "a/b/c"));
    expect(stat.isDirectory()).toBe(true);
  });

  it("deleteFile removes a file", async () => {
    await filesystem.writeFile("scratch/temp.txt", "x");
    await filesystem.deleteFile("scratch/temp.txt");
    await expect(
      fs.access(path.join(rootDir, "scratch/temp.txt")),
    ).rejects.toThrow();
  });

  it("rmdir removes a directory recursively when requested", async () => {
    await filesystem.mkdir("to-remove/sub");
    await filesystem.writeFile("to-remove/sub/x.txt", "x");
    await filesystem.rmdir("to-remove", { recursive: true });
    await expect(
      fs.access(path.join(rootDir, "to-remove")),
    ).rejects.toThrow();
  });

  it("copyFile copies a file", async () => {
    await filesystem.writeFile("source.txt", "data");
    await filesystem.copyFile("source.txt", "dest/copy.txt");
    const copied = await fs.readFile(path.join(rootDir, "dest/copy.txt"), "utf8");
    expect(copied).toBe("data");
  });

  it("moveFile renames a file", async () => {
    await filesystem.writeFile("from.txt", "data");
    await filesystem.moveFile("from.txt", "to/dest.txt");
    const moved = await fs.readFile(path.join(rootDir, "to/dest.txt"), "utf8");
    expect(moved).toBe("data");
    await expect(fs.access(path.join(rootDir, "from.txt"))).rejects.toThrow();
  });

  it("writeFile rejects path traversal outside basePath", async () => {
    await expect(
      filesystem.writeFile("../escape.txt", "x"),
    ).rejects.toThrow(/path traversal rejected/);
  });

  it("mkdir rejects path traversal outside basePath", async () => {
    await expect(filesystem.mkdir("../bad-dir")).rejects.toThrow(
      /path traversal rejected/,
    );
  });
});

describe("InProcessSandboxFilesystem", () => {
  let rootDir: string;
  let filesystem: InProcessSandboxFilesystem;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "arivie-inproc-"));
    await fs.cp(fixturesDir, rootDir, { recursive: true });
    filesystem = new InProcessSandboxFilesystem({ rootDir });
  });

  afterEach(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it("exposes kind in-process", () => {
    expect(filesystem.kind).toBe("in-process");
  });

  it("uploadFromHost copies a file into the sandbox", async () => {
    const hostFile = path.join(os.tmpdir(), `host-${Date.now()}.txt`);
    await fs.writeFile(hostFile, "uploaded\n");
    try {
      await filesystem.uploadFromHost(hostFile, "uploaded.txt");
      const content = await filesystem.readFile("uploaded.txt", {
        encoding: "utf8",
      });
      expect(content).toBe("uploaded\n");
    } finally {
      await fs.rm(hostFile, { force: true });
    }
  });

  it("runCommand runs ls on the sandbox root", async () => {
    const result = await filesystem.runCommand(["ls", rootDir], {
      allowedBinaries: ["ls"],
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("catalog.yml");
  });

  const adversarial: [string, unknown[]][] = [
    ["semicolon", [";", "ls"]],
    ["and-and", ["&&", "ls"]],
    ["or-or", ["||", "ls"]],
    ["pipe", ["|", "ls"]],
    ["gt", [">", "ls"]],
    ["lt", ["<", "ls"]],
    ["backtick", ["`", "ls"]],
    ["dollar-paren", ["$(", "ls"]],
    ["dollar-brace", ["${", "ls"]],
    ["newline", ["\n", "ls"]],
    ["carriage-return", ["\r", "ls"]],
    ["nul", ["\0", "ls"]],
    ["empty string", [""]],
    ["non-string element", [1 as unknown as string, "ls"]],
  ];

  it.each(adversarial)(
    "runCommand rejects adversarial argv: %s",
    async (_label, argv) => {
      await expect(filesystem.runCommand(argv as string[])).rejects.toThrow(
        /InProcessSandbox: rejected metacharacter/,
      );
    },
  );

  it("validateArgv rejects the same adversarial patterns", () => {
    for (const [, argv] of adversarial) {
      expect(() => validateArgv(argv)).toThrow(
        /InProcessSandbox: rejected metacharacter/,
      );
    }
  });

  it("runCommand rejects binaries outside the allowlist", async () => {
    await expect(
      filesystem.runCommand(["curl", "https://example.com"], {
        allowedBinaries: ["ls"],
      }),
    ).rejects.toThrow(/binary not in allowlist/);
  });

  it("runCommand rejects absolute path argv (cat /etc/passwd)", async () => {
    await expect(
      filesystem.runCommand(["cat", "/etc/passwd"], {
        allowedBinaries: ["cat"],
      }),
    ).rejects.toThrow(/path traversal rejected/);
  });

  it("runCommand rejects --files-from=/etc/passwd style argv", async () => {
    await expect(
      filesystem.runCommand(["cat", "--files-from=/etc/passwd"], {
        allowedBinaries: ["cat"],
      }),
    ).rejects.toThrow(/path traversal rejected/);
  });

  it("runCommand rejects slash-path executables", async () => {
    await expect(
      filesystem.runCommand(["./ls"], { allowedBinaries: ["ls"] }),
    ).rejects.toThrow(/plain name/);
    await expect(
      filesystem.runCommand(["/bin/ls"], { allowedBinaries: ["ls"] }),
    ).rejects.toThrow(/plain name/);
  });

  it("runCommand rejects cwd escape", async () => {
    await expect(
      filesystem.runCommand(["ls"], {
        allowedBinaries: ["ls"],
        cwd: "/etc",
      }),
    ).rejects.toThrow(/path traversal rejected/);
  });

  it("readFile rejects symlink escape outside sandbox root", async () => {
    const outsideDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "arivie-outside-"),
    );
    const secretFile = path.join(outsideDir, "secret.txt");
    await fs.writeFile(secretFile, "outside-secret\n");
    const linkPath = path.join(rootDir, "escape-link");
    await fs.symlink(outsideDir, linkPath);
    try {
      await expect(
        filesystem.readFile(path.join("escape-link", "secret.txt"), {
          encoding: "utf8",
        }),
      ).rejects.toThrow(/path traversal rejected/);
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });
});
