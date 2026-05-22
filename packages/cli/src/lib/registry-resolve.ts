/* SPDX-License-Identifier: Apache-2.0 */
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  SAFE_NPM_PACKAGE_NAME,
  validateRegistryFilePath,
} from "./path-safety.js";

const RegistryFileEntrySchema = z.object({
  path: z
    .string()
    .min(1)
    .refine(validateRegistryFilePath, {
      message: "registry file path must be relative and must not contain '..'",
    }),
  type: z.literal("registry:component"),
});

const safePackageNameSchema = z
  .string()
  .refine((name) => SAFE_NPM_PACKAGE_NAME.test(name), {
    message: "dependency must be a valid npm package name",
  });

export const RegistryItemSchema = z.object({
  name: z.string().min(1),
  type: z.literal("registry:ui"),
  version: z.string().min(1),
  files: z.array(RegistryFileEntrySchema).min(1),
  dependencies: z.array(safePackageNameSchema),
  shadcnDependencies: z.array(safePackageNameSchema),
  description: z.string().min(1),
});

export type RegistryItem = z.infer<typeof RegistryItemSchema>;

export interface ResolvedRegistryComponent {
  item: RegistryItem;
  registryRoot: string;
  componentDir: string;
  /** Absolute path of each source file keyed by consumer-relative path. */
  fileSources: Map<string, string>;
}

const REGISTRY_NOT_FOUND_MSG =
  "registry component not found. Tried: (1) local monorepo at packages/registry/<name>/, " +
  "(2) bundled templates at <cli>/dist/templates/registry/<name>/. " +
  "If you're in a consumer project, the bundled-template path requires @arivie/cli ≥ 0.1.1.";

export function findMonorepoRoot(startDir: string = process.cwd()): string | null {
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

function localSourcePath(componentDir: string, consumerPath: string): string {
  return join(componentDir, basename(consumerPath));
}

/**
 * Resolve a registry component, trying each tier in order.
 *
 * Tier 0 (dev mode):     `<monorepo>/packages/registry/<name>/`
 * Tier 1 (bundled):      `<cli_install>/dist/templates/registry/<name>/`
 *                        (consumers running the published @arivie/cli)
 *
 * A future Tier 2 will fetch from GitHub raw with caching; that path is
 * async and lives in a separate function (resolveRegistryComponentRemote).
 */
export function resolveRegistryComponent(
  name: string,
  startDir: string = process.cwd(),
): ResolvedRegistryComponent | null {
  return (
    resolveFromMonorepo(name, startDir) ??
    resolveFromCliBundle(name) ??
    null
  );
}

/** Tier 0: read from the arivie dev monorepo (when hacking on arivie itself). */
function resolveFromMonorepo(
  name: string,
  startDir: string,
): ResolvedRegistryComponent | null {
  const monorepoRoot = findMonorepoRoot(startDir);
  if (monorepoRoot == null) return null;
  const registryRoot = join(monorepoRoot, "packages", "registry");
  return loadFromDir(name, registryRoot);
}

/** Tier 1: read from the CLI's own install dir (the published @arivie/cli tarball). */
function resolveFromCliBundle(name: string): ResolvedRegistryComponent | null {
  // import.meta.url points at dist/lib/registry-resolve.js (after build).
  // The bundled templates live at dist/templates/registry/<name>/.
  let here: string;
  try {
    here = fileURLToPath(import.meta.url);
  } catch {
    return null;
  }
  // dist/lib/registry-resolve.js → dist/templates/registry
  const distRoot = resolve(dirname(here), "..");
  const registryRoot = join(distRoot, "templates", "registry");
  if (!existsSync(registryRoot)) return null;
  return loadFromDir(name, registryRoot);
}

/** Shared: validate manifest + collect file sources from a registry root. */
function loadFromDir(
  name: string,
  registryRoot: string,
): ResolvedRegistryComponent | null {
  const componentDir = join(registryRoot, name);
  const manifestPath = join(componentDir, "registry-item.json");

  if (!existsSync(manifestPath)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
  } catch {
    return null;
  }

  const result = RegistryItemSchema.safeParse(parsed);
  if (!result.success || result.data.name !== name) return null;

  const item = result.data;
  const fileSources = new Map<string, string>();
  for (const file of item.files) {
    const source = localSourcePath(componentDir, file.path);
    if (!existsSync(source)) return null;
    fileSources.set(file.path, source);
  }
  return { item, registryRoot, componentDir, fileSources };
}

export function registryNotFoundMessage(): string {
  return REGISTRY_NOT_FOUND_MSG;
}
