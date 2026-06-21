/* SPDX-License-Identifier: Apache-2.0 */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { ArivieConfigError } from "../errors.js";
import type { BlueprintDefinition } from "../plugins/types.js";
import {
  readInstalledBlueprints,
  writeInstalledBlueprints,
} from "./read.js";

/** Official semver.org grammar (no leading `v`). */
const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

export interface InstallBlueprintOptions {
  /** Repo root to install into. */
  destRoot: string;
  /** Overwrite files that already exist (default false → skip + report). */
  overwrite?: boolean;
}

export interface InstalledBlueprintRecord {
  id: string;
  version: string;
  installedAt: string;
  files: { path: string; sha256: string }[];
  markers: string[];
}

export interface InstallBlueprintResult {
  record: InstalledBlueprintRecord;
  written: string[];
  skipped: string[];
}

function hashContents(contents: string): string {
  return createHash("sha256").update(contents).digest("hex");
}

function resolveWithinDestRoot(destRoot: string, filePath: string): string {
  const resolvedRoot = resolve(destRoot);
  const resolved = resolve(destRoot, filePath);

  if (resolved === resolvedRoot) {
    throw new ArivieConfigError(
      `Blueprint file path ${JSON.stringify(filePath)} must not resolve to dest root`,
    );
  }

  const rootPrefix = resolvedRoot + sep;
  if (!resolved.startsWith(rootPrefix)) {
    throw new ArivieConfigError(
      `Blueprint file path ${JSON.stringify(filePath)} escapes destRoot`,
    );
  }

  return resolved;
}

function validateBlueprint(blueprint: BlueprintDefinition): void {
  if (typeof blueprint.id !== "string" || blueprint.id.length === 0) {
    throw new ArivieConfigError("Blueprint has an empty id");
  }
  if (typeof blueprint.title !== "string" || blueprint.title.length === 0) {
    throw new ArivieConfigError(
      `Blueprint "${blueprint.id}" has an empty title`,
    );
  }
  if (
    typeof blueprint.version !== "string" ||
    !SEMVER_RE.test(blueprint.version)
  ) {
    throw new ArivieConfigError(
      `Blueprint "${blueprint.id}" has invalid version ${JSON.stringify(blueprint.version)}: must be valid semver`,
    );
  }
  if (!Array.isArray(blueprint.files) || blueprint.files.length === 0) {
    throw new ArivieConfigError(
      `Blueprint "${blueprint.id}" must declare at least one file`,
    );
  }

  const markerIds = new Set<string>();
  for (const marker of blueprint.markers ?? []) {
    if (markerIds.has(marker.id)) {
      throw new ArivieConfigError(
        `Blueprint "${blueprint.id}" declares duplicate marker "${marker.id}"`,
      );
    }
    markerIds.add(marker.id);
  }
}

export function installBlueprint(
  blueprint: BlueprintDefinition,
  options: InstallBlueprintOptions,
): InstallBlueprintResult {
  validateBlueprint(blueprint);

  const destRoot = resolve(options.destRoot);
  const overwrite = options.overwrite ?? false;
  const written: string[] = [];
  const skipped: string[] = [];
  const fileRecords: InstalledBlueprintRecord["files"] = [];

  for (const file of blueprint.files) {
    const absolutePath = resolveWithinDestRoot(destRoot, file.path);
    const sha256 = hashContents(file.contents);
    fileRecords.push({ path: file.path, sha256 });

    if (existsSync(absolutePath) && !overwrite) {
      skipped.push(file.path);
      continue;
    }

    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, file.contents, "utf8");
    written.push(file.path);
  }

  const record: InstalledBlueprintRecord = {
    id: blueprint.id,
    version: blueprint.version,
    installedAt: new Date().toISOString(),
    files: fileRecords,
    markers: (blueprint.markers ?? []).map((marker) => marker.id),
  };

  const existing = readInstalledBlueprints(destRoot);
  const updated = [
    ...existing.filter((entry) => entry.id !== blueprint.id),
    record,
  ];
  writeInstalledBlueprints(destRoot, updated);

  return { record, written, skipped };
}
