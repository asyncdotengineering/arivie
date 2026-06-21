/* SPDX-License-Identifier: Apache-2.0 */
import {
  codegen,
  formatLintReport,
  lint,
  loadSemanticLayer,
} from "@arivie/semantic";
import { defineCommand } from "citty";
import { semanticPathFromConfig } from "../lib/app-config.js";
import { loadArivieConfig } from "../lib/load-config.js";
import { resolveSemanticPath } from "../lib/resolve-semantic-path.js";

/**
 * Load semantic layer, lint, print report, emit `.generated/index.ts`.
 * @see RFC-002 §4.12
 */
export async function runLint(configPath: string): Promise<number> {
  const config = await loadArivieConfig(configPath);
  const semanticPath = resolveSemanticPath(configPath, semanticPathFromConfig(config));
  const layer = await loadSemanticLayer(semanticPath);
  const report = lint(layer);

  console.log(formatLintReport(report));

  await codegen(layer, semanticPath);

  if (report.errors.length === 0) {
    console.log(`✓ Emitted ${semanticPath}/.generated/index.ts`);
    return 0;
  }

  return 1;
}

export const lintCommand = defineCommand({
  meta: {
    name: "lint",
    description: "Validate semantic layer and emit generated index",
  },
  args: {
    config: {
      type: "string",
      description: "Path to arivie.config.ts",
      default: "./arivie.config.ts",
    },
  },
  async run({ args }) {
    return runLint(args.config);
  },
});
