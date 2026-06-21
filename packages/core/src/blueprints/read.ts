/* SPDX-License-Identifier: Apache-2.0 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { InstalledBlueprintRecord } from "./install.js";

const MANIFEST_RELATIVE = join(".arivie", "blueprints.json");

function manifestPath(destRoot: string): string {
  return join(resolve(destRoot), MANIFEST_RELATIVE);
}

export function readInstalledBlueprints(
  destRoot: string,
): InstalledBlueprintRecord[] {
  const path = manifestPath(destRoot);
  if (!existsSync(path)) {
    return [];
  }

  const raw = readFileSync(path, "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed as InstalledBlueprintRecord[];
}

export function writeInstalledBlueprints(
  destRoot: string,
  records: InstalledBlueprintRecord[],
): void {
  const path = manifestPath(destRoot);
  mkdirSync(join(resolve(destRoot), ".arivie"), { recursive: true });
  writeFileSync(path, `${JSON.stringify(records, null, 2)}\n`, "utf8");
}

export function isBlueprintInstalled(destRoot: string, id: string): boolean {
  return readInstalledBlueprints(destRoot).some((record) => record.id === id);
}
