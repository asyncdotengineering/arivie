/* SPDX-License-Identifier: Apache-2.0 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  CopyOptions,
  FileContent,
  FileEntry,
  FileStat,
  ListOptions,
  ProviderStatus,
  ReadOptions,
  RemoveOptions,
  WorkspaceFilesystem,
  WriteOptions,
} from "@mastra/core/workspace";
import {
  confineArgvPathArg,
  resolveWithinRoot,
  safeAccess,
  safeReadFile,
  safeStat,
} from "../path-guard.js";
import {
  buildFilesystemInfo,
  guardSandboxPath,
  rejectAppendFile,
  rejectCopyFile,
  rejectDeleteFile,
  rejectMkdir,
  rejectMoveFile,
  rejectRmdir,
  rejectWriteFile,
  toFileStat,
} from "./shared.js";

const METACHAR_SUBSTRINGS = [
  ";",
  "&&",
  "||",
  "|",
  ">",
  "<",
  "`",
  "$(",
  "${",
  "\n",
  "\r",
  "\0",
] as const;

/**
 * Default binaries allowed when `allowedBinaries` is not overridden.
 * Read-only navigation only — opt in to `node`/`pnpm` via `allowedBinaries` (widens attack surface).
 */
export const DEFAULT_IN_PROCESS_ALLOWED_BINARIES = [
  "ls",
  "cat",
  "head",
  "grep",
  "rg",
] as const;

export interface InProcessSandboxRunCommandOptions {
  /** When set, only these binary names (basename of argv[0]) may run. */
  allowedBinaries?: string[];
  cwd?: string;
  timeoutMs?: number;
}

export interface InProcessSandboxFilesystemOptions {
  rootDir: string;
  allowedBinaries?: string[];
  /**
   * When `true`, every write/mutate operation rejects with a `ReadOnlyError`
   * — write_file, edit_file, mkdir, delete, copy, move all become no-ops.
   * Use for mounted host directories you want the agent to navigate but
   * not mutate (e.g. a read-only `/docs` directory).
   *
   * Default `false`: the agent can write to the sandboxed basePath. All
   * mutations are path-confined to `rootDir` via `guardSandboxPath`, so
   * writes outside the root still throw.
   *
   * Default flipped from `true` in v0.2 because the single-agent shape
   * needs `mastra_workspace_write_file` for file artifacts (report files,
   * CSVs, scratch JSON). Mastra hides every `requireWrite: true` tool
   * (write_file, edit_file, delete, mkdir, ast_edit, index) when
   * `filesystem.readOnly === true`, so a read-only filesystem leaves the
   * agent without a write surface.
   */
  readOnly?: boolean;
}

export interface InProcessRunCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class InProcessSandboxFilesystem implements WorkspaceFilesystem {
  readonly id: string;
  readonly name = "InProcessSandboxFilesystem";
  readonly provider = "arivie-in-process-sandbox";
  readonly readOnly: boolean;
  readonly basePath: string;
  readonly kind = "in-process" as const;
  status: ProviderStatus = "running";

  private readonly defaultAllowedBinaries: readonly string[];

  constructor(opts: InProcessSandboxFilesystemOptions) {
    this.basePath = path.resolve(opts.rootDir);
    this.id = `in-process-sandbox-${this.basePath}`;
    this.defaultAllowedBinaries =
      opts.allowedBinaries ?? DEFAULT_IN_PROCESS_ALLOWED_BINARIES;
    this.readOnly = opts.readOnly ?? false;
  }

  private resolve(filePath: string): string {
    return guardSandboxPath(this.basePath, filePath);
  }

  async readFile(
    filePath: string,
    options?: ReadOptions,
  ): Promise<string | Buffer> {
    const absolute = this.resolve(filePath);
    return safeReadFile(this.basePath, absolute, options);
  }

  async readdir(dirPath: string, options?: ListOptions): Promise<FileEntry[]> {
    const absolute = this.resolve(dirPath);
    const entries = await fs.readdir(absolute, { withFileTypes: true });
    const mapped = entries.map(
      (entry): FileEntry => ({
        name: entry.name,
        type: entry.isDirectory() ? "directory" : "file",
      }),
    );

    if (options?.extension) {
      const extensions = Array.isArray(options.extension)
        ? options.extension
        : [options.extension];
      return mapped.filter((entry) => {
        if (entry.type === "directory") {
          return true;
        }
        return extensions.some((ext) => entry.name.endsWith(ext));
      });
    }

    return mapped;
  }

  async exists(filePath: string): Promise<boolean> {
    const absolute = this.resolve(filePath);
    try {
      await safeAccess(this.basePath, absolute);
      return true;
    } catch {
      return false;
    }
  }

  async stat(filePath: string): Promise<FileStat> {
    const absolute = this.resolve(filePath);
    const stats = await safeStat(this.basePath, absolute);
    return toFileStat(this.basePath, absolute, stats);
  }

  async writeFile(
    filePath: string,
    content: FileContent,
    options?: WriteOptions,
  ): Promise<void> {
    if (this.readOnly) {
      return rejectWriteFile(filePath, content, options);
    }
    const absolute = this.resolve(filePath);
    if (options?.recursive !== false) {
      await fs.mkdir(path.dirname(absolute), { recursive: true });
    }
    const flag = options?.overwrite === false ? "wx" : "w";
    if (typeof content === "string") {
      await fs.writeFile(absolute, content, { encoding: "utf8", flag });
    } else {
      await fs.writeFile(absolute, content, { flag });
    }
  }

  async appendFile(filePath: string, content: FileContent): Promise<void> {
    if (this.readOnly) {
      return rejectAppendFile(filePath, content);
    }
    const absolute = this.resolve(filePath);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    if (typeof content === "string") {
      await fs.appendFile(absolute, content, "utf8");
    } else {
      await fs.appendFile(absolute, content);
    }
  }

  async deleteFile(filePath: string, options?: RemoveOptions): Promise<void> {
    if (this.readOnly) {
      return rejectDeleteFile(filePath, options);
    }
    const absolute = this.resolve(filePath);
    await fs.rm(absolute, {
      recursive: options?.recursive ?? false,
      force: false,
    });
  }

  async copyFile(
    src: string,
    dest: string,
    options?: CopyOptions,
  ): Promise<void> {
    if (this.readOnly) {
      return rejectCopyFile(src, dest, options);
    }
    const absoluteSrc = this.resolve(src);
    const absoluteDest = this.resolve(dest);
    await fs.mkdir(path.dirname(absoluteDest), { recursive: true });
    const srcStat = await fs.stat(absoluteSrc);
    if (srcStat.isDirectory()) {
      await fs.cp(absoluteSrc, absoluteDest, {
        recursive: true,
        force: options?.overwrite ?? false,
      });
    } else {
      const flag = options?.overwrite === false ? "wx" : "w";
      const data = await fs.readFile(absoluteSrc);
      await fs.writeFile(absoluteDest, data, { flag });
    }
  }

  async moveFile(
    src: string,
    dest: string,
    options?: CopyOptions,
  ): Promise<void> {
    if (this.readOnly) {
      return rejectMoveFile(src, dest, options);
    }
    const absoluteSrc = this.resolve(src);
    const absoluteDest = this.resolve(dest);
    await fs.mkdir(path.dirname(absoluteDest), { recursive: true });
    await fs.rename(absoluteSrc, absoluteDest);
  }

  async mkdir(
    dirPath: string,
    options?: { recursive?: boolean },
  ): Promise<void> {
    if (this.readOnly) {
      return rejectMkdir(dirPath, options);
    }
    const absolute = this.resolve(dirPath);
    await fs.mkdir(absolute, { recursive: options?.recursive ?? true });
  }

  async rmdir(dirPath: string, options?: RemoveOptions): Promise<void> {
    if (this.readOnly) {
      return rejectRmdir(dirPath, options);
    }
    const absolute = this.resolve(dirPath);
    await fs.rm(absolute, {
      recursive: options?.recursive ?? false,
      force: false,
    });
  }

  /**
   * Copy a host path into the sandbox root. Used by `makeWorkspace` at creation.
   */
  async uploadFromHost(hostPath: string, sandboxPath: string): Promise<void> {
    const src = path.resolve(hostPath);
    const dest = this.resolve(sandboxPath);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    const srcStat = await fs.stat(src);
    if (srcStat.isDirectory()) {
      await fs.cp(src, dest, { recursive: true });
    } else {
      await fs.copyFile(src, dest);
    }
  }

  /**
   * Run a subprocess with `argv[0]` as the binary. Never uses a shell.
   * Rejects shell metacharacters in every argv element.
   */
  async runCommand(
    argv: string[],
    opts?: InProcessSandboxRunCommandOptions,
  ): Promise<InProcessRunCommandResult> {
    validateArgv(argv);
    if (argv[0]!.includes("/") || argv[0]!.includes("\\")) {
      throw new Error(
        "InProcessSandbox: executable must be a plain name (no path separators); resolved via allowlist",
      );
    }
    for (let i = 1; i < argv.length; i++) {
      confineArgvPathArg(this.basePath, argv[i]!);
    }
    const allowed =
      opts?.allowedBinaries ?? [...this.defaultAllowedBinaries];
    const binaryName = path.basename(argv[0]!);
    if (!allowed.includes(binaryName)) {
      throw new Error(
        `InProcessSandbox: binary not in allowlist: ${binaryName}`,
      );
    }

    const executable = await resolveBinaryPath(argv[0]!);
    const cwd =
      opts?.cwd !== undefined
        ? resolveWithinRoot(this.basePath, opts.cwd)
        : this.basePath;

    return new Promise((resolve, reject) => {
      const child = spawn(executable, argv.slice(1), {
        shell: false,
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      const timeoutMs = opts?.timeoutMs;
      const timer =
        timeoutMs !== undefined
          ? setTimeout(() => {
              child.kill("SIGTERM");
              reject(new Error(`InProcessSandbox: command timed out after ${timeoutMs}ms`));
            }, timeoutMs)
          : undefined;

      child.on("error", (err) => {
        if (timer !== undefined) {
          clearTimeout(timer);
        }
        reject(err);
      });

      child.on("close", (code) => {
        if (timer !== undefined) {
          clearTimeout(timer);
        }
        resolve({
          stdout,
          stderr,
          exitCode: code ?? 1,
        });
      });
    });
  }

  getInfo() {
    return buildFilesystemInfo({
      id: this.id,
      name: this.name,
      provider: this.provider,
      status: this.status,
      basePath: this.basePath,
      kind: this.kind,
    });
  }
}

export function validateArgv(argv: unknown): asserts argv is string[] {
  if (!Array.isArray(argv)) {
    throw new Error("InProcessSandbox: argv must be an array");
  }

  for (let i = 0; i < argv.length; i++) {
    const element = argv[i];
    if (typeof element !== "string") {
      throw new Error(
        `InProcessSandbox: rejected metacharacter in argv element ${i}`,
      );
    }
    if (element.length === 0) {
      throw new Error(
        `InProcessSandbox: rejected metacharacter in argv element ${i}`,
      );
    }
    for (let j = 0; j < element.length; j++) {
      const code = element.charCodeAt(j);
      if (code < 32 || code === 127) {
        throw new Error(
          `InProcessSandbox: rejected metacharacter in argv element ${i}`,
        );
      }
    }
    for (const pattern of METACHAR_SUBSTRINGS) {
      if (element.includes(pattern)) {
        throw new Error(
          `InProcessSandbox: rejected metacharacter in argv element ${i}`,
        );
      }
    }
  }
}

async function resolveBinaryPath(binary: string): Promise<string> {
  if (binary.includes("/") || binary.includes("\\")) {
    throw new Error(
      "InProcessSandbox: executable must be a plain name (no path separators); resolved via allowlist",
    );
  }

  return new Promise((resolve) => {
    const which = spawn("which", [binary], {
      shell: false,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let out = "";
    which.stdout?.on("data", (chunk: Buffer) => {
      out += chunk.toString();
    });
    which.on("error", () => resolve(binary));
    which.on("close", (code) => {
      const trimmed = out.trim();
      if (code === 0 && trimmed.length > 0) {
        resolve(trimmed);
      } else {
        resolve(binary);
      }
    });
  });
}
