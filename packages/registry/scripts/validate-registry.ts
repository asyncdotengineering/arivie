/* SPDX-License-Identifier: Apache-2.0 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  COMPONENT_DIRS,
  RegistryItemSchema,
  type RegistryItem,
} from "./registry-schema.js";

const PACKAGE_ROOT = join(fileURLToPath(import.meta.url), "..", "..");

export interface ValidateRegistryResult {
  ok: boolean;
  errors: string[];
  componentCount: number;
}

function localFileForConsumerPath(
  componentDir: string,
  consumerPath: string,
): string {
  return join(PACKAGE_ROOT, componentDir, basename(consumerPath));
}

export function validateRegistry(
  rootDir: string = PACKAGE_ROOT,
): ValidateRegistryResult {
  const errors: string[] = [];
  let componentCount = 0;

  for (const dirName of COMPONENT_DIRS) {
    const componentDir = join(rootDir, dirName);
    const manifestPath = join(componentDir, "registry-item.json");

    if (!existsSync(manifestPath)) {
      errors.push(`${dirName}: missing registry-item.json`);
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${dirName}: invalid JSON — ${message}`);
      continue;
    }

    const result = RegistryItemSchema.safeParse(parsed);
    if (!result.success) {
      errors.push(
        `${dirName}: schema validation failed — ${result.error.message}`,
      );
      continue;
    }

    const item: RegistryItem = result.data;
    componentCount += 1;

    if (item.name !== dirName) {
      errors.push(
        `${dirName}: name "${item.name}" does not match subdirectory`,
      );
    }

    for (const file of item.files) {
      const localPath = localFileForConsumerPath(dirName, file.path);
      if (!existsSync(localPath)) {
        errors.push(
          `${dirName}: files[].path "${file.path}" — missing local file ${basename(file.path)}`,
        );
      }
    }

    const manifestFiles = new Set(
      item.files.map((f) => basename(f.path)),
    );
    const onDisk = readdirSync(componentDir).filter(
      (f: string) => f !== "registry-item.json",
    );
    for (const diskFile of onDisk) {
      if (!manifestFiles.has(diskFile)) {
        errors.push(
          `${dirName}: "${diskFile}" exists on disk but is not listed in files[]`,
        );
      }
    }
  }

  const foundDirs = readdirSync(rootDir, { withFileTypes: true })
    .filter(
      (d: { isDirectory: () => boolean; name: string }) =>
        d.isDirectory() &&
        !["scripts", "test", "node_modules"].includes(d.name),
    )
    .map((d: { name: string }) => d.name);

  for (const dir of foundDirs) {
    if (
      existsSync(join(rootDir, dir, "registry-item.json")) &&
      !(COMPONENT_DIRS as readonly string[]).includes(dir)
    ) {
      errors.push(`${dir}: unexpected component directory (not in manifest list)`);
    }
  }

  return { ok: errors.length === 0, errors, componentCount };
}

export function main(): number {
  const { ok, errors, componentCount } = validateRegistry();

  if (!ok) {
    for (const err of errors) {
      console.error(`registry validate: ${err}`);
    }
    console.error(
      `registry validate: ${componentCount}/${COMPONENT_DIRS.length} components passed`,
    );
    return 1;
  }

  console.log(
    `registry validate: ${componentCount}/${COMPONENT_DIRS.length} components OK`,
  );
  return 0;
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  process.exit(main());
}
