/* SPDX-License-Identifier: Apache-2.0 */
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ArivieConfigError } from "@arivie/core";
import { createJiti } from "jiti";
import { isArivieAppConfig, type CliArivieConfig } from "./app-config.js";

function pickConfigExport(mod: Record<string, unknown>): unknown {
  const candidates = [mod.config, mod.arivieConfig, mod.default];
  for (const candidate of candidates) {
    if (candidate !== undefined) return candidate;
  }
  return undefined;
}

export async function loadArivieConfig(configPath: string): Promise<CliArivieConfig> {
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
      `No config export found in ${configPath} (expected default, config, or arivieConfig)`,
    );
  }

  if (isArivieAppConfig(picked)) {
    return picked;
  }

  throw new ArivieConfigError(
    `Export from ${configPath} is not a recognised ArivieAppConfig`,
  );
}
