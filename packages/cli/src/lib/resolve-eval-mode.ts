/* SPDX-License-Identifier: Apache-2.0 */
import { existsSync } from "node:fs";
import type { ArivieConfig } from "@arivie/core/types";
import { ArivieConfigError } from "@arivie/core";
import { autoDetectMode } from "@arivie/agent";
import { loadSemanticLayerSync } from "@arivie/semantic";
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

function modeFromConfig(config: ArivieConfig, configPath: string): EvalMode {
  if (config.semantic.mode !== "auto") {
    return config.semantic.mode;
  }
  const semanticRoot = resolveSemanticPath(configPath, config.semantic.path);
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
