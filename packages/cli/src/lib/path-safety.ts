/* SPDX-License-Identifier: Apache-2.0 */
import path from "node:path";

/** v0.1 table identifier surface — plain alphanumerics + underscore only. */
export const SAFE_TABLE_NAME = /^[a-zA-Z0-9_]+$/;

/** npm package name token (scoped or unscoped). */
export const SAFE_NPM_PACKAGE_NAME =
  /^(@[a-z0-9-]+\/)?[a-z0-9-][a-z0-9-_.]*$/i;

export function validateTableName(tableName: string): string | null {
  if (!SAFE_TABLE_NAME.test(tableName)) {
    return `Invalid table name "${tableName}": only letters, numbers, and underscore are allowed`;
  }
  return null;
}

/** Ensure `targetPath` resolves inside `baseDir` (defence against `..` traversal). */
export function assertPathUnderBase(baseDir: string, targetPath: string): void {
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(targetPath);
  const rel = path.relative(resolvedBase, resolvedTarget);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Path escapes allowed directory: ${targetPath}`);
  }
}

export function validateRegistryFilePath(filePath: string): boolean {
  return filePath.length > 0 && !filePath.startsWith("/") && !filePath.includes("..");
}

export function validateNpmPackageName(name: string): boolean {
  return SAFE_NPM_PACKAGE_NAME.test(name);
}
