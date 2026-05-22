/* SPDX-License-Identifier: Apache-2.0 */
import fs from "node:fs/promises";
import path from "node:path";
import type {
  CopyOptions,
  FileContent,
  FileEntry,
  FileStat,
  FilesystemInfo,
  ListOptions,
  ProviderStatus,
  ReadOptions,
  RemoveOptions,
  WorkspaceFilesystem,
  WriteOptions,
} from "@mastra/core/workspace";
import { ReadOnlyError } from "./errors.js";
import {
  resolveWithinRoot,
  safeAccess,
  safeReadFile,
  safeStat,
} from "./path-guard.js";

export interface SemanticLayerFilesystemOptions {
  rootDir: string;
  readonly?: true;
}

export class SemanticLayerFilesystem implements WorkspaceFilesystem {
  readonly id: string;
  readonly name = "SemanticLayerFilesystem";
  readonly provider = "arivie-semantic-layer";
  readonly kind = "local" as const;
  readonly readOnly = true;
  readonly basePath: string;
  status: ProviderStatus = "running";

  constructor(opts: SemanticLayerFilesystemOptions) {
    this.id = `semantic-layer-${path.resolve(opts.rootDir)}`;
    this.basePath = path.resolve(opts.rootDir);
  }

  private resolve(filePath: string): string {
    return resolveWithinRoot(this.basePath, filePath);
  }

  private toWorkspacePath(absolute: string): string {
    const relative = path.relative(this.basePath, absolute);
    return relative === "" ? "/" : `/${relative.split(path.sep).join("/")}`;
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
    const mapped = entries.map((entry): FileEntry => {
      const item: FileEntry = {
        name: entry.name,
        type: entry.isDirectory() ? "directory" : "file",
      };
      return item;
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
    return {
      name: path.basename(absolute),
      path: this.toWorkspacePath(absolute),
      type: stats.isDirectory() ? "directory" : "file",
      size: Number(stats.size),
      createdAt: stats.birthtime,
      modifiedAt: stats.mtime,
    };
  }

  async writeFile(
    filePath: string,
    _content: FileContent,
    _options?: WriteOptions,
  ): Promise<void> {
    throw new ReadOnlyError({ path: filePath });
  }

  async appendFile(filePath: string, _content: FileContent): Promise<void> {
    throw new ReadOnlyError({ path: filePath });
  }

  async deleteFile(filePath: string, _options?: RemoveOptions): Promise<void> {
    throw new ReadOnlyError({ path: filePath });
  }

  async copyFile(
    _src: string,
    dest: string,
    _options?: CopyOptions,
  ): Promise<void> {
    throw new ReadOnlyError({ path: dest });
  }

  async moveFile(
    _src: string,
    dest: string,
    _options?: CopyOptions,
  ): Promise<void> {
    throw new ReadOnlyError({ path: dest });
  }

  async mkdir(
    dirPath: string,
    _options?: { recursive?: boolean },
  ): Promise<void> {
    throw new ReadOnlyError({ path: dirPath });
  }

  async rmdir(dirPath: string, _options?: RemoveOptions): Promise<void> {
    throw new ReadOnlyError({ path: dirPath });
  }

  getInfo(): FilesystemInfo {
    return {
      id: this.id,
      name: this.name,
      provider: this.provider,
      status: this.status,
      readOnly: this.readOnly,
      metadata: { basePath: this.basePath },
    };
  }
}
