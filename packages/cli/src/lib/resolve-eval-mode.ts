/* SPDX-License-Identifier: Apache-2.0 */
import { existsSync } from "node:fs";
import { ArivieConfigError } from "@arivie/core";
import { autoDetectMode } from "@arivie/agent";
import { loadSemanticLayerSync } from "@arivie/semantic";
import type { CliArivieConfig } from "./app-config.js";
import { semanticModeFromConfig, semanticPathFromConfig } from "./app-config.js";
import { loadArivieConfig } from "./load-config.js";
import { resolveSemanticPath } from "./resolve-semantic-path.js";

export type EvalMode = "preload" | "indexed";

const EVAL_MODES: readonly EvalMode[] = ["preload", "indexed"];

export function parseEvalModeFlag(value: string | undefined): EvalMode | undefined {
  if (value == null || value.length === 0) {
    return undefined;
  }
  if ((EVAL_MODES as readonly string[]).includes(value)) {
    return value as EvalMode;
  }
  throw new ArivieConfigError(
    `Invalid --mode "${value}"; expected preload or indexed`,
  );
}

function modeFromConfig(config: CliArivieConfig, configPath: string): EvalMode {
  const mode = semanticModeFromConfig(config);
  if (mode !== "auto") {
    return mode;
  }
  const semanticRoot = resolveSemanticPath(configPath, semanticPathFromConfig(config));
  if (!existsSync(semanticRoot)) {
    return "preload";
  }
  const layer = loadSemanticLayerSync(semanticRoot);
  return autoDetectMode(layer);
}

export async function resolveEvalMode(
  configPath: string,
  cliMode?: string,
): Promise<EvalMode> {
  const config = await loadArivieConfig(configPath);
  const explicit = parseEvalModeFlag(cliMode);
  if (explicit != null) {
    return explicit;
  }
  return modeFromConfig(config, configPath);
}
