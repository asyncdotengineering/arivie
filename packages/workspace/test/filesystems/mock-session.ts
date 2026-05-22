/* SPDX-License-Identifier: Apache-2.0 */
import fs from "node:fs/promises";
import path from "node:path";
import type { FileEntry, FileStat, ReadOptions } from "@mastra/core/workspace";
import type { DockerSandboxClient } from "../../src/filesystems/docker.js";
import type { VercelSandboxSession } from "../../src/filesystems/vercel.js";
import {
  DEFAULT_DOCKER_SANDBOX_BASE,
  DEFAULT_VERCEL_SANDBOX_BASE,
  toFileStat,
} from "../../src/filesystems/shared.js";

function hostPathForSandbox(
  hostRoot: string,
  basePath: string,
  sandboxPath: string,
): string {
  const relative = path.posix.relative(
    basePath.replace(/\\/g, "/"),
    sandboxPath.replace(/\\/g, "/"),
  );
  return path.join(hostRoot, relative);
}

export function createLocalBackedVercelSession(
  hostRoot: string,
  basePath = DEFAULT_VERCEL_SANDBOX_BASE,
): VercelSandboxSession {
  const writes: { path: string; content: Buffer }[] = [];

  return {
    fs: {
      async readFile(filePath, options) {
        const host = hostPathForSandbox(hostRoot, basePath, filePath);
        if (options && typeof options === "object" && options.encoding) {
          return fs.readFile(host, { encoding: options.encoding });
        }
        if (typeof options === "string") {
          return fs.readFile(host, { encoding: options });
        }
        return fs.readFile(host);
      },
      async readdir(dirPath) {
        const host = hostPathForSandbox(hostRoot, basePath, dirPath);
        const entries = await fs.readdir(host, { withFileTypes: true });
        return entries;
      },
      async stat(filePath) {
        const host = hostPathForSandbox(hostRoot, basePath, filePath);
        return fs.stat(host);
      },
      async exists(filePath) {
        const host = hostPathForSandbox(hostRoot, basePath, filePath);
        try {
          await fs.access(host);
          return true;
        } catch {
          return false;
        }
      },
    },
    async writeFiles(files) {
      for (const file of files) {
        writes.push({
          path: file.path,
          content: Buffer.isBuffer(file.content)
            ? file.content
            : Buffer.from(file.content),
        });
        const host = hostPathForSandbox(hostRoot, basePath, file.path);
        await fs.mkdir(path.dirname(host), { recursive: true });
        await fs.writeFile(host, file.content);
      }
    },
    getWrites: () => writes,
  } as VercelSandboxSession & { getWrites(): typeof writes };
}

export function createLocalBackedDockerClient(
  hostRoot: string,
  basePath = DEFAULT_DOCKER_SANDBOX_BASE,
): DockerSandboxClient {
  return {
    async readFile(filePath, options?: ReadOptions) {
      const host = hostPathForSandbox(hostRoot, basePath, filePath);
      if (options?.encoding !== undefined) {
        return fs.readFile(host, { encoding: options.encoding });
      }
      return fs.readFile(host);
    },
    async readdir(dirPath) {
      const host = hostPathForSandbox(hostRoot, basePath, dirPath);
      const entries = await fs.readdir(host, { withFileTypes: true });
      return entries.map(
        (entry): FileEntry => ({
          name: entry.name,
          type: entry.isDirectory() ? "directory" : "file",
        }),
      );
    },
    async exists(filePath) {
      const host = hostPathForSandbox(hostRoot, basePath, filePath);
      try {
        await fs.access(host);
        return true;
      } catch {
        return false;
      }
    },
    async stat(filePath): Promise<FileStat> {
      const host = hostPathForSandbox(hostRoot, basePath, filePath);
      const stats = await fs.stat(host);
      return toFileStat(basePath, filePath, stats);
    },
    async putFile(hostSrc, sandboxDest) {
      const destHost = hostPathForSandbox(hostRoot, basePath, sandboxDest);
      await fs.mkdir(path.dirname(destHost), { recursive: true });
      const stat = await fs.stat(hostSrc);
      if (stat.isDirectory()) {
        await fs.cp(hostSrc, destHost, { recursive: true });
      } else {
        await fs.copyFile(hostSrc, destHost);
      }
    },
  };
}
