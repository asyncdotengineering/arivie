/* SPDX-License-Identifier: Apache-2.0 */
import { defineCommand, runCommand, showUsage } from "citty";
import { addCommand } from "./commands/add.js";
import { buildCommand } from "./commands/build.js";
import { deployCommand } from "./commands/deploy.js";
import { devCommand } from "./commands/dev.js";
import { evalCommand } from "./commands/eval.js";
import { infoCommand } from "./commands/info.js";
import { initCommand } from "./commands/init.js";
import { lintCommand } from "./commands/lint.js";
import { mcpCommand } from "./commands/mcp.js";
import { setupCommand } from "./commands/setup.js";
import { typesCommand } from "./commands/types.js";

interface CliCommand {
  subCommands?: Record<string, CliCommand>;
  run?: (context: unknown) => Promise<number | void>;
}

const rootCommand = defineCommand({
  meta: {
    name: "arivie",
    version: "0.0.0",
    description: "Arivie CLI — agentic analytics on Mastra",
  },
  args: {
    config: {
      type: "string",
      description: "Path to arivie.config.ts",
      default: "./arivie.config.ts",
    },
  },
  subCommands: {
    init: initCommand,
    setup: setupCommand,
    add: addCommand,
    info: infoCommand,
    lint: lintCommand,
    eval: evalCommand,
    dev: devCommand,
    build: buildCommand,
    deploy: deployCommand,
    types: typesCommand,
    mcp: mcpCommand,
  },
});

function findSubCommandIndex(argv: string[], names: string[]): number {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") {
      return -1;
    }
    if (arg?.startsWith("-")) {
      continue;
    }
    if (arg !== undefined && names.includes(arg)) {
      return i;
    }
  }
  return -1;
}

/**
 * Resolve the deepest leaf command so citty's container `subCommands` dispatch
 * does not swallow nested exit codes (e.g. `add ui` / `add entity` / `add skill`).
 */
function resolveLeafCommand(
  command: CliCommand,
  rawArgs: string[],
): { command: CliCommand; rawArgs: string[] } {
  let current = command;
  let remaining = rawArgs;

  for (;;) {
    const subCommands = current.subCommands;
    if (subCommands == null || Object.keys(subCommands).length === 0) {
      break;
    }
    const names = Object.keys(subCommands);
    const subIndex = findSubCommandIndex(remaining, names);
    if (subIndex === -1) {
      break;
    }
    const subName = remaining[subIndex] as string;
    const next = subCommands[subName];
    if (next == null) {
      break;
    }
    current = next;
    remaining = remaining.slice(subIndex + 1);
  }

  return { command: current, rawArgs: remaining };
}

/**
 * Parse argv and run the Arivie CLI. Returns a process exit code.
 * @see RFC-002 §4.12
 */
export async function runCli(argv: string[]): Promise<number> {
  try {
    if (argv.length === 0) {
      await showUsage(rootCommand);
      return 1;
    }

    if (argv.includes("--help") || argv.includes("-h")) {
      await showUsage(rootCommand);
      return 0;
    }

    const rootNames = Object.keys(rootCommand.subCommands ?? {});
    const subIndex = findSubCommandIndex(argv, rootNames);
    if (subIndex === -1) {
      await showUsage(rootCommand);
      return 1;
    }

    const subName = argv[subIndex] as keyof typeof rootCommand.subCommands;
    const sub = rootCommand.subCommands?.[subName];
    if (!sub) {
      await showUsage(rootCommand);
      return 1;
    }

    const { command: leaf, rawArgs: leafArgs } = resolveLeafCommand(
      sub,
      argv.slice(subIndex + 1),
    );

    if (
      leaf.subCommands != null &&
      Object.keys(leaf.subCommands).length > 0 &&
      typeof leaf.run !== "function"
    ) {
      await showUsage(leaf);
      return 1;
    }

    const { result } = await runCommand(leaf, { rawArgs: leafArgs });
    return typeof result === "number" ? result : 0;
  } catch (err) {
    if (isCittyCliError(err)) {
      await showUsage(rootCommand);
      if (err instanceof Error) {
        console.error(err.message);
      }
      return 1;
    }
    throw err;
  }
}

function isCittyCliError(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false;
  }
  if (err.name === "CLIError") {
    return true;
  }
  const msg = err.message.toLowerCase();
  return (
    msg.includes("unknown") ||
    msg.includes("invalid") ||
    msg.includes("unexpected") ||
    msg.includes("not found") ||
    msg.includes("missing required")
  );
}
