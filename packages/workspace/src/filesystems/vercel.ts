/* SPDX-License-Identifier: Apache-2.0 */
import fs from "node:fs/promises";
import path from "node:path";
import type { Sandbox } from "@vercel/sandbox";
import type { NetworkPolicy } from "@vercel/sandbox";
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
  DEFAULT_VERCEL_SANDBOX_BASE,
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

export type VercelSandboxRunCommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

/** Injectable Vercel Sandbox session for tests and custom wiring. */
export interface VercelSandboxSession {
  readonly fs: Sandbox["fs"];
  writeFiles: Sandbox["writeFiles"];
  stop?(): Promise<void>;
  runCommand?(
    argv: string[],
    opts?: { timeoutMs?: number },
  ): Promise<VercelSandboxRunCommandResult>;
}

export interface VercelSandboxCredentials {
  token: string;
  teamId: string;
  projectId: string;
}

export interface VercelSandboxNetworkOptions {
  /** When false (default), sandbox network egress is denied. */
  egress: boolean;
}

/** Optional timing hooks for HS-3 bench harness. */
export interface VercelSandboxBenchHooks {
  onSpinUpComplete?: (durationMs: number) => void;
  onUploadComplete?: (durationMs: number) => void;
  onReadFileComplete?: (durationMs: number) => void;
}

export interface VercelSandboxFilesystemOptions {
  resources?: { vcpus?: number };
  timeoutMs?: number;
  /** Host path → sandbox path uploads applied when the session becomes ready. */
  uploadAtCreate?: Record<string, string>;
  /** Pre-built session (mocks). When omitted, a live sandbox is created. */
  session?: VercelSandboxSession | (() => Promise<VercelSandboxSession>);
  basePath?: string;
  /** Network egress; defaults to disabled (`egress: false`). */
  network?: Partial<VercelSandboxNetworkOptions>;
  credentials?: Partial<VercelSandboxCredentials>;
  bench?: VercelSandboxBenchHooks;
}

const MISSING_CREDS_MESSAGE =
  "VercelSandboxFilesystem requires VERCEL_TOKEN, VERCEL_TEAM_ID, and VERCEL_PROJECT_ID " +
  "(or credentials in options) when not using a mock session";

/** True when `VERCEL_TOKEN` is set (bench skip gate per HS-3). */
export function hasVercelBenchCreds(): boolean {
  return Boolean(process.env.VERCEL_TOKEN?.trim());
}

/** Resolve access-token credentials from options and env. */
export function resolveVercelSandboxCredentials(
  overrides?: Partial<VercelSandboxCredentials>,
): VercelSandboxCredentials | undefined {
  const token = overrides?.token ?? process.env.VERCEL_TOKEN?.trim();
  const teamId = overrides?.teamId ?? process.env.VERCEL_TEAM_ID?.trim();
  const projectId =
    overrides?.projectId ?? process.env.VERCEL_PROJECT_ID?.trim();
  if (token && teamId && projectId) {
    return { token, teamId, projectId };
  }
  return undefined;
}

/** Map filesystem network opts to Vercel Sandbox `networkPolicy`. */
export function resolveVercelNetworkPolicy(
  network?: Partial<VercelSandboxNetworkOptions>,
): NetworkPolicy {
  const egress = network?.egress ?? false;
  return egress ? "allow-all" : "deny-all";
}

/** Build `Sandbox.create` params from filesystem options (testable without live API). */
export function buildVercelSandboxCreateParams(
  opts: Pick<
    VercelSandboxFilesystemOptions,
    "resources" | "timeoutMs" | "network" | "credentials"
  >,
): {
  resources: { vcpus: number };
  timeout: number;
  networkPolicy: NetworkPolicy;
  token?: string;
  teamId?: string;
  projectId?: string;
} {
  const creds = resolveVercelSandboxCredentials(opts.credentials);
  return {
    resources: { vcpus: opts.resources?.vcpus ?? 4 },
    timeout: opts.timeoutMs ?? 45 * 60 * 1000,
    networkPolicy: resolveVercelNetworkPolicy(opts.network),
    ...(creds
      ? {
          token: creds.token,
          teamId: creds.teamId,
          projectId: creds.projectId,
        }
      : {}),
  };
}

export class VercelSandboxFilesystem implements WorkspaceFilesystem {
  readonly id: string;
  readonly name = "VercelSandboxFilesystem";
  readonly provider = "arivie-vercel-sandbox";
  readonly readOnly = true;
  readonly basePath: string;
  readonly kind = "vercel" as const;
  status: ProviderStatus = "starting";

  private readonly opts: VercelSandboxFilesystemOptions;
  private ready?: Promise<VercelSandboxSession>;
  private readonly benchHooks: VercelSandboxBenchHooks | undefined;
  private session?: VercelSandboxSession;

  constructor(opts: VercelSandboxFilesystemOptions = {}) {
    this.basePath = opts.basePath ?? DEFAULT_VERCEL_SANDBOX_BASE;
    this.id = `vercel-sandbox-${crypto.randomUUID()}`;
    this.benchHooks = opts.bench;
    this.opts = opts;
    if (opts.session !== undefined) {
      this.ready = this.initSession(opts);
    }
  }

  private async initSession(
    opts: VercelSandboxFilesystemOptions,
  ): Promise<VercelSandboxSession> {
    if (opts.session !== undefined) {
      const session =
        typeof opts.session === "function"
          ? await opts.session()
          : opts.session;
      this.session = session;
      this.status = "running";
      if (opts.uploadAtCreate) {
        await this.applyUploadAtCreate(session, opts.uploadAtCreate, opts.bench);
      }
      return session;
    }

    const creds = resolveVercelSandboxCredentials(opts.credentials);
    if (!creds) {
      throw new Error(MISSING_CREDS_MESSAGE);
    }

    let VercelSandbox: typeof import("@vercel/sandbox").Sandbox;
    try {
      ({ Sandbox: VercelSandbox } = await import("@vercel/sandbox"));
    } catch {
      throw new Error(
        "VercelSandboxFilesystem requires optional dependency @vercel/sandbox — install with: pnpm add @vercel/sandbox",
      );
    }

    const createParams = buildVercelSandboxCreateParams(opts);
    const spinUpStart = performance.now();
    const sandbox = await VercelSandbox.create(
      createParams as Parameters<typeof VercelSandbox.create>[0],
    );
    opts.bench?.onSpinUpComplete?.(performance.now() - spinUpStart);

    const session: VercelSandboxSession = {
      fs: sandbox.fs,
      writeFiles: (files) => sandbox.writeFiles(files),
      stop: () => sandbox.stop().then(() => undefined),
      runCommand: async (argv) => {
        const finished = await sandbox.runCommand({
          cmd: argv[0]!,
          args: argv.slice(1),
        });
        const [stdout, stderr] = await Promise.all([
          finished.stdout(),
          finished.stderr(),
        ]);
        return { stdout, stderr, exitCode: finished.exitCode };
      },
    };
    this.session = session;
    this.status = "running";
    if (opts.uploadAtCreate) {
      await this.applyUploadAtCreate(session, opts.uploadAtCreate, opts.bench);
    }
    return session;
  }

  private async applyUploadAtCreate(
    session: VercelSandboxSession,
    uploads: Record<string, string>,
    bench?: VercelSandboxBenchHooks,
  ): Promise<void> {
    const uploadStart = performance.now();
    for (const [hostPath, sandboxPath] of Object.entries(uploads)) {
      await this.uploadFromHostWithSession(session, hostPath, sandboxPath);
    }
    bench?.onUploadComplete?.(performance.now() - uploadStart);
  }

  private resolve(filePath: string): string {
    return guardSandboxPath(this.basePath, filePath);
  }

  private getSession(): Promise<VercelSandboxSession> {
    if (!this.ready) {
      this.ready = this.initSession(this.opts);
    }
    return this.ready;
  }

  async readFile(
    filePath: string,
    options?: ReadOptions,
  ): Promise<string | Buffer> {
    const readStart = performance.now();
    const session = await this.getSession();
    const absolute = this.resolve(filePath);
    let result: string | Buffer;
    if (options?.encoding !== undefined) {
      result = await session.fs.readFile(absolute, {
        encoding: options.encoding,
      });
    } else {
      result = await session.fs.readFile(absolute, null);
    }
    this.benchHooks?.onReadFileComplete?.(performance.now() - readStart);
    return result;
  }

  async readdir(dirPath: string, options?: ListOptions): Promise<FileEntry[]> {
    const session = await this.getSession();
    const absolute = this.resolve(dirPath);
    const raw = await session.fs.readdir(absolute, { withFileTypes: true });
    const mapped = raw.map((entry): FileEntry => {
      if (typeof entry === "string") {
        return { name: entry, type: "file" };
      }
      return {
        name: entry.name,
        type: entry.isDirectory() ? "directory" : "file",
      };
    });

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
    const session = await this.getSession();
    const absolute = this.resolve(filePath);
    return session.fs.exists(absolute);
  }

  async stat(filePath: string): Promise<FileStat> {
    const session = await this.getSession();
    const absolute = this.resolve(filePath);
    const stats = await session.fs.stat(absolute);
    return toFileStat(this.basePath, absolute, stats);
  }

  async writeFile(
    filePath: string,
    content: FileContent,
    options?: WriteOptions,
  ): Promise<void> {
    return rejectWriteFile(filePath, content, options);
  }

  async appendFile(filePath: string, content: FileContent): Promise<void> {
    return rejectAppendFile(filePath, content);
  }

  async deleteFile(filePath: string, options?: RemoveOptions): Promise<void> {
    return rejectDeleteFile(filePath, options);
  }

  async copyFile(
    src: string,
    dest: string,
    options?: CopyOptions,
  ): Promise<void> {
    return rejectCopyFile(src, dest, options);
  }

  async moveFile(
    src: string,
    dest: string,
    options?: CopyOptions,
  ): Promise<void> {
    return rejectMoveFile(src, dest, options);
  }

  async mkdir(
    dirPath: string,
    options?: { recursive?: boolean },
  ): Promise<void> {
    return rejectMkdir(dirPath, options);
  }

  async rmdir(dirPath: string, options?: RemoveOptions): Promise<void> {
    return rejectRmdir(dirPath, options);
  }

  async uploadFromHost(hostPath: string, sandboxPath: string): Promise<void> {
    const uploadStart = performance.now();
    const session = await this.getSession();
    await this.uploadFromHostWithSession(session, hostPath, sandboxPath);
    this.benchHooks?.onUploadComplete?.(performance.now() - uploadStart);
  }

  /** Run a command inside the Vercel Sandbox (never on the host). */
  async runCommand(
    argv: string[],
    _opts?: { timeoutMs?: number },
  ): Promise<VercelSandboxRunCommandResult> {
    const session = await this.getSession();
    if (session.runCommand === undefined) {
      throw new Error("VercelSandboxFilesystem: session does not support runCommand");
    }
    return session.runCommand(argv, _opts);
  }

  private async uploadFromHostWithSession(
    session: VercelSandboxSession,
    hostPath: string,
    sandboxPath: string,
  ): Promise<void> {
    const src = path.resolve(hostPath);
    const dest = this.resolve(sandboxPath);
    const stat = await fs.stat(src);
    if (stat.isDirectory()) {
      await this.uploadDirectoryFromHost(session, src, dest);
      return;
    }
    const content = await fs.readFile(src);
    await session.writeFiles([{ path: dest, content }]);
  }

  private async uploadDirectoryFromHost(
    session: VercelSandboxSession,
    hostDir: string,
    sandboxDir: string,
  ): Promise<void> {
    const files: { path: string; content: Buffer }[] = [];
    await collectHostFiles(hostDir, sandboxDir, files);
    if (files.length > 0) {
      await session.writeFiles(files);
    }
  }

  async stop(): Promise<void> {
    const session = await this.getSession();
    if (session.stop) {
      await session.stop();
    }
    this.status = "stopped";
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

async function collectHostFiles(
  hostDir: string,
  sandboxDir: string,
  out: { path: string; content: Buffer }[],
): Promise<void> {
  const entries = await fs.readdir(hostDir, { withFileTypes: true });
  for (const entry of entries) {
    const hostPath = path.join(hostDir, entry.name);
    const sandboxPath = path.posix.join(
      sandboxDir.replace(/\\/g, "/"),
      entry.name,
    );
    if (entry.isDirectory()) {
      await collectHostFiles(hostPath, sandboxPath, out);
    } else {
      out.push({ path: sandboxPath, content: await fs.readFile(hostPath) });
    }
  }
}
