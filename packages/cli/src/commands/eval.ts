/* SPDX-License-Identifier: Apache-2.0 */
import { spawn } from "node:child_process";
import { join } from "node:path";
import { defineCommand } from "citty";
import { ARIVIE_MONOREPO_ROOT } from "../lib/arivie-root.js";
import { printCliCommandError } from "../lib/cli-errors.js";
import { loadArivieConfig } from "../lib/load-config.js";

const EVAL_MODULE = join(ARIVIE_MONOREPO_ROOT, "scripts", "run-eval.ts");

export interface EvalRunner {
  run(): Promise<number>;
}

function defaultEvalRunner(): EvalRunner {
  return {
    run(): Promise<number> {
      return new Promise((resolve) => {
        const child = spawn("pnpm", ["exec", "tsx", EVAL_MODULE], {
          stdio: "inherit",
          cwd: ARIVIE_MONOREPO_ROOT,
          // shell: true — required for Windows PATH lookup; argv is fully-controlled (no user input).
          shell: process.platform === "win32",
        });
        child.on("error", () => resolve(1));
        child.on("close", (code) => resolve(code ?? 1));
      });
    },
  };
}

/**
 * Run the dogfood golden-SQL eval gate (navigation vs the frozen preload
 * baseline; see scripts/run-eval.ts). Validates the project config loads, then
 * runs the gate. There is no context mode — navigation is the only delivery path.
 */
export async function runEvalCommand(
  configPath: string,
  runner: EvalRunner = defaultEvalRunner(),
): Promise<number> {
  try {
    await loadArivieConfig(configPath);
    return await runner.run();
  } catch (err) {
    printCliCommandError("eval", err);
    return 1;
  }
}

export const evalCommand = defineCommand({
  meta: {
    name: "eval",
    description: "Run golden-SQL eval gate (dogfood probes)",
  },
  args: {
    config: {
      type: "string",
      description: "Path to arivie.config.ts",
      default: "./arivie.config.ts",
    },
  },
  async run({ args }) {
    return runEvalCommand(args.config);
  },
});

/** @internal Path to `scripts/run-eval.ts` for tests. */
export const runEvalScriptPath = EVAL_MODULE;
