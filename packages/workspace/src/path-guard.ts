/* SPDX-License-Identifier: Apache-2.0 */
import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { FileNotFoundError } from "@mastra/core/workspace";

export function resolveWithinRoot(rootDir: string, requested: string): string {
  const resolvedRoot = path.resolve(rootDir);
  const resolved = path.resolve(rootDir, requested);

  if (resolved === resolvedRoot) {
    return resolved;
  }

  const rootPrefix = resolvedRoot + path.sep;
  if (!resolved.startsWith(rootPrefix)) {
    throw new Error(`path traversal rejected: ${requested}`);
  }

  return resolved;
}

/** True when an argv element may carry a filesystem path (incl. `--opt=/abs/path`). */
export function argvElementLooksLikePath(arg: string): boolean {
  return (
    arg.startsWith("/") ||
    arg.startsWith("~") ||
    arg.startsWith("./") ||
    arg.startsWith("../") ||
    arg.includes("/")
  );
}

/** Confine a path-like argv element to `rootDir`; throws on escape. */
export function confineArgvPathArg(rootDir: string, arg: string): void {
  if (!argvElementLooksLikePath(arg)) {
    return;
  }

  const eq = arg.indexOf("=");
  if (eq !== -1) {
    const suffix = arg.slice(eq + 1);
    if (suffix.length > 0 && argvElementLooksLikePath(suffix)) {
      resolveWithinRoot(rootDir, suffix);
      return;
    }
  }

  if (arg.startsWith("-")) {
    return;
  }

  resolveWithinRoot(rootDir, arg);
}

function isEnoent(err: unknown): boolean {
  return (
    err != null &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code: string }).code === "ENOENT"
  );
}

/** Ensure `absolute` resolves under the real path of `rootDir` (symlink-safe). */
export async function confineRealPath(
  rootDir: string,
  absolute: string,
): Promise<void> {
  const resolvedRoot = await fs.realpath(rootDir);
  const rootPrefix = resolvedRoot + path.sep;

  try {
    const realTarget = await fs.realpath(absolute);
    if (realTarget !== resolvedRoot && !realTarget.startsWith(rootPrefix)) {
      throw new Error(`path traversal rejected: ${absolute}`);
    }
    return;
  } catch (err) {
    if (!isEnoent(err)) {
      throw err;
    }
  }

  const parent = path.dirname(absolute);
  const realParent = await fs.realpath(parent);
  if (realParent !== resolvedRoot && !realParent.startsWith(rootPrefix)) {
    throw new Error(`path traversal rejected: ${absolute}`);
  }
}

const O_NOFOLLOW = constants.O_NOFOLLOW ?? 0;

/**
 * Read via fd with O_NOFOLLOW when supported, after realpath confinement.
 * TODO: re-realpath via /proc/self/fd for stricter TOCTOU closure on Linux.
 */
export async function safeReadFile(
  rootDir: string,
  absolute: string,
  options?: ReadOptions,
): Promise<string | Buffer> {
  await confineRealPath(rootDir, absolute);

  const flags = constants.O_RDONLY | O_NOFOLLOW;
  try {
    const handle = await fs.open(absolute, flags);
    try {
      const buf = await handle.readFile();
      if (options?.encoding !== undefined) {
        return buf.toString(options.encoding);
      }
      return buf;
    } finally {
      await handle.close();
    }
  } catch (err) {
    if (O_NOFOLLOW === 0) {
      if (options?.encoding !== undefined) {
        return fs.readFile(absolute, { encoding: options.encoding });
      }
      return fs.readFile(absolute);
    }
    throw err;
  }
}

export async function safeAccess(rootDir: string, absolute: string): Promise<void> {
  await confineRealPath(rootDir, absolute);
  const flags = constants.O_RDONLY | O_NOFOLLOW;
  try {
    const handle = await fs.open(absolute, flags);
    await handle.close();
  } catch (err) {
    if (O_NOFOLLOW === 0) {
      await fs.access(absolute);
      return;
    }
    throw err;
  }
}

export async function safeStat(
  rootDir: string,
  absolute: string,
): Promise<Awaited<ReturnType<typeof fs.stat>>> {
  await confineRealPath(rootDir, absolute);
  try {
    return await fs.stat(absolute);
  } catch (err) {
    // Mastra's write-path wrapper pre-stats the target to compute
    // expectedMtime; it only catches `FileNotFoundError`, not the raw
    // Node ENOENT (chunk-VGB7UO5R.cjs `wrapWithReadTracker`). Translate
    // so write_file on a brand-new path actually creates the file
    // instead of bubbling ENOENT all the way to the agent.
    if (isEnoent(err)) {
      throw new FileNotFoundError(absolute);
    }
    throw err;
  }
}

type ReadOptions = { encoding?: BufferEncoding };
