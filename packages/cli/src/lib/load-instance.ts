/* SPDX-License-Identifier: Apache-2.0 */
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ArivieConfigError, defineArivie, type ArivieApp } from "@arivie/core";
import { createJiti } from "jiti";
import { isArivieAppConfig } from "./app-config.js";

function isArivieApp(value: unknown): value is ArivieApp {
  if (value == null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.handler === "function" &&
    v.sessions != null &&
    typeof v.sessions === "object" &&
    v.runtime != null
  );
}

function pickConfigExport(mod: Record<string, unknown>): unknown {
  const candidates = [mod.arivie, mod.default, mod.config, mod.arivieConfig];
  for (const candidate of candidates) {
    if (candidate !== undefined) return candidate;
  }
  return undefined;
}

export async function loadArivieInstance(configPath: string): Promise<ArivieApp> {
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

  if (isArivieApp(picked)) return picked;
  if (isArivieAppConfig(picked)) return defineArivie(picked);

  throw new ArivieConfigError(
    `Export from ${configPath} is not a recognised ArivieAppConfig or ArivieApp`,
  );
}
