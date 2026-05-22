/* SPDX-License-Identifier: Apache-2.0 */
import type { WorkspaceFilesystem } from "@mastra/core/workspace";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { InProcessSandboxRunCommandOptions } from "../filesystems/in-process.js";

export type SandboxRunCommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type SandboxRunCommandFilesystem = WorkspaceFilesystem & {
  runCommand(
    argv: string[],
    opts?: InProcessSandboxRunCommandOptions,
  ): Promise<SandboxRunCommandResult>;
};

const workspaceBashInputSchema = z.object({
  argv: z
    .array(z.string())
    .min(1)
    .describe(
      "Argv array: argv[0] is the binary name, remaining elements are arguments (no shell parsing)",
    ),
});

export interface WorkspaceBashToolOptions {
  filesystem: SandboxRunCommandFilesystem;
}

/** REQ-40: opt-in `workspace_bash` — runs argv via the sandbox filesystem's `runCommand`. */
export function workspaceBashTool(opts: WorkspaceBashToolOptions) {
  const { filesystem } = opts;

  return createTool({
    id: "workspace_bash",
    description:
      "Run a command inside the workspace sandbox using an argv array (no shell). " +
      "argv[0] is the binary; remaining elements are passed as arguments.",
    inputSchema: workspaceBashInputSchema,
    execute: async ({ argv }): Promise<SandboxRunCommandResult> => {
      return filesystem.runCommand(argv);
    },
  });
}
