/* SPDX-License-Identifier: Apache-2.0 */
import fs from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import type Dockerode from "dockerode";
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
  DEFAULT_DOCKER_SANDBOX_BASE,
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

export type DockerSandboxRunCommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

/** Injectable Docker sandbox client for tests and custom wiring. */
export interface DockerSandboxClient {
  readFile(
    filePath: string,
    options?: ReadOptions,
  ): Promise<string | Buffer>;
  readdir(dirPath: string, options?: ListOptions): Promise<FileEntry[]>;
  exists(filePath: string): Promise<boolean>;
  stat(filePath: string): Promise<FileStat>;
  putFile(hostPath: string, sandboxPath: string): Promise<void>;
  stop?(): Promise<void>;
  runCommand?(argv: string[]): Promise<DockerSandboxRunCommandResult>;
}

export interface DockerSandboxFilesystemOptions {
  /** Pre-built client (mocks). When omitted, a client is built from `docker` + `containerId`. */
  client?: DockerSandboxClient | (() => Promise<DockerSandboxClient>);
  docker?: Dockerode;
  containerId?: string;
  basePath?: string;
  uploadAtCreate?: Record<string, string>;
}

export class DockerSandboxFilesystem implements WorkspaceFilesystem {
  readonly id: string;
  readonly name = "DockerSandboxFilesystem";
  readonly provider = "arivie-docker-sandbox";
  readonly readOnly = true;
  readonly basePath: string;
  readonly kind = "docker" as const;
  status: ProviderStatus = "starting";

  private readonly ready: Promise<DockerSandboxClient>;

  constructor(opts: DockerSandboxFilesystemOptions = {}) {
    this.basePath = opts.basePath ?? DEFAULT_DOCKER_SANDBOX_BASE;
    this.id = `docker-sandbox-${crypto.randomUUID()}`;
    this.ready = this.initClient(opts);
  }

  private async initClient(
    opts: DockerSandboxFilesystemOptions,
  ): Promise<DockerSandboxClient> {
    if (opts.client !== undefined) {
      const client =
        typeof opts.client === "function" ? await opts.client() : opts.client;
      this.status = "running";
      if (opts.uploadAtCreate) {
        for (const [hostPath, sandboxPath] of Object.entries(
          opts.uploadAtCreate,
        )) {
          await client.putFile(hostPath, sandboxPath);
        }
      }
      return client;
    }

    if (!opts.docker || !opts.containerId) {
      throw new Error(
        "DockerSandboxFilesystem requires client or docker + containerId",
      );
    }

    const client = createDockerodeClient(
      opts.docker,
      opts.containerId,
      this.basePath,
    );
    this.status = "running";
    if (opts.uploadAtCreate) {
      for (const [hostPath, sandboxPath] of Object.entries(opts.uploadAtCreate)) {
        await client.putFile(hostPath, sandboxPath);
      }
    }
    return client;
  }

  private resolve(filePath: string): string {
    return guardSandboxPath(this.basePath, filePath);
  }

  private async getClient(): Promise<DockerSandboxClient> {
    return this.ready;
  }

  async readFile(
    filePath: string,
    options?: ReadOptions,
  ): Promise<string | Buffer> {
    const client = await this.getClient();
    const absolute = this.resolve(filePath);
    return client.readFile(absolute, options);
  }

  async readdir(dirPath: string, options?: ListOptions): Promise<FileEntry[]> {
    const client = await this.getClient();
    const absolute = this.resolve(dirPath);
    return client.readdir(absolute, options);
  }

  async exists(filePath: string): Promise<boolean> {
    const client = await this.getClient();
    const absolute = this.resolve(filePath);
    return client.exists(absolute);
  }

  async stat(filePath: string): Promise<FileStat> {
    const client = await this.getClient();
    const absolute = this.resolve(filePath);
    return client.stat(absolute);
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
    const client = await this.getClient();
    const dest = this.resolve(sandboxPath);
    await client.putFile(path.resolve(hostPath), dest);
  }

  /** Run a command inside the Docker container (never on the host). */
  async runCommand(argv: string[]): Promise<DockerSandboxRunCommandResult> {
    const client = await this.getClient();
    if (client.runCommand === undefined) {
      throw new Error("DockerSandboxFilesystem: client does not support runCommand");
    }
    return client.runCommand(argv);
  }

  async stop(): Promise<void> {
    const client = await this.getClient();
    if (client.stop) {
      await client.stop();
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

function createDockerodeClient(
  docker: Dockerode,
  containerId: string,
  basePath: string,
): DockerSandboxClient {
  const container = docker.getContainer(containerId);

  async function execWithStreams(
    cmd: string[],
  ): Promise<DockerSandboxRunCommandResult> {
    const exec = await container.exec({
      Cmd: cmd,
      AttachStdout: true,
      AttachStderr: true,
    });
    const stream = await exec.start({ hijack: true, stdin: false });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const stdoutStream = new PassThrough();
    const stderrStream = new PassThrough();
    stdoutStream.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    stderrStream.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    await new Promise<void>((resolve, reject) => {
      if (container.modem?.demuxStream != null) {
        container.modem.demuxStream(stream, stdoutStream, stderrStream);
      } else {
        stream.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
      }
      stream.on("end", resolve);
      stream.on("error", reject);
    });
    const inspect = await exec.inspect();
    return {
      stdout: Buffer.concat(stdoutChunks).toString("utf8"),
      stderr: Buffer.concat(stderrChunks).toString("utf8"),
      exitCode: inspect.ExitCode ?? 1,
    };
  }

  return {
    async runCommand(argv) {
      return execWithStreams(argv);
    },
    async readFile(filePath, options) {
      const { stdout, exitCode } = await execWithStreams(["cat", filePath]);
      if (exitCode !== 0) {
        throw new Error(`DockerSandbox: read failed for ${filePath}`);
      }
      if (options?.encoding !== undefined) {
        return stdout;
      }
      return Buffer.from(stdout, "utf8");
    },
    async readdir(dirPath) {
      const { stdout, exitCode } = await execWithStreams([
        "find",
        dirPath,
        "-maxdepth",
        "1",
        "-mindepth",
        "1",
        "-printf",
        "%f %y\\n",
      ]);
      if (exitCode !== 0) {
        throw new Error(`DockerSandbox: readdir failed for ${dirPath}`);
      }
      return stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => {
          const [name, kind] = line.split(" ");
          return {
            name: name ?? line,
            type: kind === "d" ? ("directory" as const) : ("file" as const),
          };
        });
    },
    async exists(filePath) {
      const { exitCode } = await execWithStreams(["test", "-e", filePath]);
      return exitCode === 0;
    },
    async stat(filePath) {
      const { stdout, exitCode } = await execWithStreams([
        "stat",
        "-c",
        "%s %Y %W %F",
        filePath,
      ]);
      if (exitCode !== 0) {
        throw new Error(`DockerSandbox: stat failed for ${filePath}`);
      }
      const [sizeRaw, mtimeRaw, birthRaw, typeRaw] = stdout.trim().split(" ");
      const size = Number(sizeRaw);
      const mtime = new Date(Number(mtimeRaw) * 1000);
      const birth = new Date(Number(birthRaw) * 1000);
      const isDir = typeRaw?.includes("directory") ?? false;
      return toFileStat(basePath, filePath, {
        isDirectory: () => isDir,
        size,
        birthtime: birth,
        mtime,
      });
    },
    async putFile(hostPath, sandboxPath) {
      const srcStat = await fs.stat(hostPath);
      if (srcStat.isDirectory()) {
        await putDirectory(container, hostPath, sandboxPath);
        return;
      }
      await ensureParentDir(container, sandboxPath);
      await writeFileViaTee(container, hostPath, sandboxPath);
    },
  };
}

async function ensureParentDir(
  container: Dockerode.Container,
  sandboxPath: string,
): Promise<void> {
  const parent = path.posix.dirname(sandboxPath.replace(/\\/g, "/"));
  const exec = await container.exec({
    Cmd: ["mkdir", "-p", parent],
    AttachStdout: false,
    AttachStderr: false,
  });
  await exec.start({ hijack: true, stdin: false });
}

async function writeFileViaTee(
  container: Dockerode.Container,
  hostPath: string,
  sandboxPath: string,
): Promise<void> {
  const content = await fs.readFile(hostPath);
  const exec = await container.exec({
    Cmd: ["tee", sandboxPath],
    AttachStdin: true,
    AttachStdout: false,
    AttachStderr: false,
  });
  const stream = await exec.start({ hijack: true, stdin: true });
  await new Promise<void>((resolve, reject) => {
    stream.on("error", reject);
    stream.on("end", resolve);
    stream.write(content, (err) => {
      if (err) {
        reject(err);
        return;
      }
      stream.end();
    });
  });
}

async function putDirectory(
  container: Dockerode.Container,
  hostDir: string,
  sandboxDir: string,
): Promise<void> {
  const exec = await container.exec({
    Cmd: ["mkdir", "-p", sandboxDir],
    AttachStdout: false,
    AttachStderr: false,
  });
  await exec.start({ hijack: true, stdin: false });

  const entries = await fs.readdir(hostDir, { withFileTypes: true });
  for (const entry of entries) {
    const hostPath = path.join(hostDir, entry.name);
    const sandboxPath = path.posix.join(
      sandboxDir.replace(/\\/g, "/"),
      entry.name,
    );
    if (entry.isDirectory()) {
      await putDirectory(container, hostPath, sandboxPath);
    } else {
      await writeFileViaTee(container, hostPath, sandboxPath);
    }
  }
}
