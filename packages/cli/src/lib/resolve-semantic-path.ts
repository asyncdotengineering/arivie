/* SPDX-License-Identifier: Apache-2.0 */
import { isAbsolute, dirname, resolve } from "node:path";

/** Resolve `semantic.path` relative to the config file directory. */
export function resolveSemanticPath(
  configPath: string,
  semanticPath: string,
): string {
  if (isAbsolute(semanticPath)) {
    return semanticPath;
  }
  const configDir = dirname(resolve(process.cwd(), configPath));
  return resolve(configDir, semanticPath);
}
