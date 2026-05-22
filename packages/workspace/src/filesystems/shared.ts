/* SPDX-License-Identifier: Apache-2.0 */
import path from "node:path";
import type {
  CopyOptions,
  FileContent,
  FileStat,
  FilesystemInfo,
  ProviderStatus,
  RemoveOptions,
  WriteOptions,
} from "@mastra/core/workspace";
import { ReadOnlyError } from "../errors.js";
import { resolveWithinRoot } from "../path-guard.js";

export const DEFAULT_VERCEL_SANDBOX_BASE = "/vercel/sandbox";
export const DEFAULT_DOCKER_SANDBOX_BASE = "/workspace";

export function guardSandboxPath(basePath: string, requested: string): string {
  return resolveWithinRoot(basePath, requested);
}

export function toWorkspacePath(basePath: string, absolute: string): string {
  const relative = path.relative(basePath, absolute);
  return relative === "" ? "/" : `/${relative.split(path.sep).join("/")}`;
}

export function toFileStat(
  basePath: string,
  absolute: string,
  stats: {
    isDirectory(): boolean;
    size: number | bigint;
    birthtime: Date;
    mtime: Date;
  },
): FileStat {
  return {
    name: path.basename(absolute),
    path: toWorkspacePath(basePath, absolute),
    type: stats.isDirectory() ? "directory" : "file",
    size: Number(stats.size),
    createdAt: stats.birthtime,
    modifiedAt: stats.mtime,
  };
}

export function rejectWrite(filePath: string): never {
  throw new ReadOnlyError({ path: filePath });
}

export async function rejectWriteFile(
  filePath: string,
  _content: FileContent,
  _options?: WriteOptions,
): Promise<void> {
  rejectWrite(filePath);
}

export async function rejectAppendFile(
  filePath: string,
  _content: FileContent,
): Promise<void> {
  rejectWrite(filePath);
}

export async function rejectDeleteFile(
  filePath: string,
  _options?: RemoveOptions,
): Promise<void> {
  rejectWrite(filePath);
}

export async function rejectCopyFile(
  _src: string,
  dest: string,
  _options?: CopyOptions,
): Promise<void> {
  rejectWrite(dest);
}

export async function rejectMoveFile(
  _src: string,
  dest: string,
  _options?: CopyOptions,
): Promise<void> {
  rejectWrite(dest);
}

export async function rejectMkdir(
  dirPath: string,
  _options?: { recursive?: boolean },
): Promise<void> {
  rejectWrite(dirPath);
}

export async function rejectRmdir(
  dirPath: string,
  _options?: RemoveOptions,
): Promise<void> {
  rejectWrite(dirPath);
}

export function buildFilesystemInfo(opts: {
  id: string;
  name: string;
  provider: string;
  status: ProviderStatus;
  basePath: string;
  kind: string;
}): FilesystemInfo {
  return {
    id: opts.id,
    name: opts.name,
    provider: opts.provider,
    status: opts.status,
    readOnly: true,
    metadata: { basePath: opts.basePath, kind: opts.kind },
  };
}
