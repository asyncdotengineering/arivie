/* SPDX-License-Identifier: Apache-2.0 */
import { ArivieNotImplementedError } from "@arivie/core";
import { defineCommand } from "citty";

const DEPLOY_MESSAGE =
  "deploy not implemented; lands in Sprint 5 C32 with @arivie/deploy package.";

/**
 * Deploy stub — real recipes ship with @arivie/deploy in Sprint 5 C32.
 */
export function runDeploy(_target: string): never {
  throw new ArivieNotImplementedError(DEPLOY_MESSAGE);
}

export const deployCommand = defineCommand({
  meta: {
    name: "deploy",
    description: "Emit deploy recipe for a target (not yet implemented)",
  },
  args: {
    target: {
      type: "positional",
      description: "Deploy target (e.g. cloudflare-do, vercel)",
      required: true,
    },
  },
  run({ args }) {
    try {
      runDeploy(args.target);
      return 0;
    } catch (err) {
      const message =
        err instanceof ArivieNotImplementedError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      console.error(`Error: ${message}`);
      return 1;
    }
  },
});
