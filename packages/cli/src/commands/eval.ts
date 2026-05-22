/* SPDX-License-Identifier: Apache-2.0 */
import { spawn } from "node:child_process";
import { join } from "node:path";
import { defineCommand } from "citty";
import { ARIVIE_MONOREPO_ROOT } from "../lib/arivie-root.js";
import { printCliCommandError } from "../lib/cli-errors.js";
import { resolveEvalMode } from "../lib/resolve-eval-mode.js";

const EVAL_MODULE = join(ARIVIE_MONOREPO_ROOT, "scripts", "run-eval.ts");

export interface EvalRunner {
  run(mode: string): Promise<number>;
}

function defaultEvalRunner(): EvalRunner {
  return {
    run(mode: string): Promise<number> {
      return new Promise((resolve) => {
        const child = spawn(
          "pnpm",
          ["exec", "tsx", EVAL_MODULE, "--mode", mode],
          {
            stdio: "inherit",
            cwd: ARIVIE_MONOREPO_ROOT,
            // shell: true — required for Windows PATH lookup; argv is fully-controlled (no user input).
            shell: process.platform === "win32",
          },
        );
        child.on("error", () => resolve(1));
        child.on("close", (code) => resolve(code ?? 1));
      });
    },
  };
}

/**
 * Run dogfood golden-SQL eval suite for the given context mode.
 */
export async function runEvalCommand(
  configPath: string,
  cliMode: string | undefined,
  runner: EvalRunner = defaultEvalRunner(),
): Promise<number> {
  try {
    const mode = await resolveEvalMode(configPath, cliMode);
    return await runner.run(mode);
  } catch (err) {
    printCliCommandError("eval", err);
    return 1;
  }
}

export const evalCommand = defineCommand({
  meta: {
    name: "eval",
    description: "Run golden-SQL eval suite (dogfood probes)",
  },
  args: {
    config: {
      type: "string",
      description: "Path to arivie.config.ts",
      default: "./arivie.config.ts",
    },
    mode: {
      type: "string",
      description: "Context mode: preload or indexed (default: from config)",
    },
  },
  async run({ args }) {
    return runEvalCommand(args.config, args.mode);
  },
});

/** @internal Path to `scripts/run-eval.ts` for tests. */
export const runEvalScriptPath = EVAL_MODULE;
