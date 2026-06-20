/* SPDX-License-Identifier: Apache-2.0 */
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ArivieConfigError, defineArivie } from "@arivie/core";
import type { ArivieConfig, ArivieInstance } from "@arivie/core/types";
import { createJiti } from "jiti";

function isArivieConfig(value: unknown): value is ArivieConfig {
  if (value == null || typeof value !== "object") {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    typeof v.owner === "object" &&
    v.owner != null &&
    typeof (v.owner as { id?: unknown }).id === "string" &&
    "sources" in v &&
    typeof v.sources === "object" &&
    v.sources != null &&
    "workspace" in v &&
    typeof v.workspace === "object" &&
    "semantic" in v &&
    typeof v.semantic === "object"
  );
}

function isArivieInstance(value: unknown): value is ArivieInstance {
  if (value == null || typeof value !== "object") {
    return false;
  }
  const v = value as Record<string, unknown>;
  return typeof v.handler === "function" && v.mastra != null;
}

function pickConfigExport(mod: Record<string, unknown>): unknown {
  const candidates = [mod.config, mod.arivieConfig, mod.default, mod.arivie];
  for (const candidate of candidates) {
    if (candidate !== undefined) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * Load an arivie.config.ts and return a usable ArivieInstance.
 * If the file exports a raw config, defineArivie() is invoked for the caller.
 */
export async function loadArivieInstance(configPath: string): Promise<ArivieInstance> {
  const absPath = isAbsolute(configPath)
    ? configPath
    : resolve(process.cwd(), configPath);

  const jiti = createJiti(dirname(absPath), {
    interopDefault: true,
    moduleCache: false,
  });

  let loaded: unknown;
  try {
    loaded = await jiti.import(pathToFileURL(absPath).href);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ArivieConfigError(`Failed to load ${configPath}: ${message}`);
  }

  const mod =
    loaded != null && typeof loaded === "object"
      ? (loaded as Record<string, unknown>)
      : { default: loaded };

  const picked = pickConfigExport(mod);
  if (picked === undefined) {
    throw new ArivieConfigError(
      `No config export found in ${configPath} (expected default, config, arivieConfig, or arivie)`,
    );
  }

  if (isArivieInstance(picked)) {
    return picked;
  }

  if (isArivieConfig(picked)) {
    return defineArivie(picked);
  }

  throw new ArivieConfigError(
    `Export from ${configPath} is not a recognised Arivie config or instance`,
  );
}
