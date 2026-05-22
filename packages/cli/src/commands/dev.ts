/* SPDX-License-Identifier: Apache-2.0 */
import { spawn } from "node:child_process";
import { defineCommand } from "citty";

const MASTRA_MISSING =
  "mastra dev required; install via `pnpm i -D mastra` or via your global setup";

/** Sprint 4 will wire real Mastra panel routes. */
export const DEV_PANEL_URLS = [
  "http://localhost:4111/arivie/semantic-browser",
  "http://localhost:4111/arivie/sql-inspector",
  "http://localhost:4111/arivie/run-timeline",
] as const;

export interface DevRunner {
  checkMastra(): Promise<boolean>;
  spawnMastraDev(): ReturnType<typeof spawn>;
}

function defaultDevRunner(): DevRunner {
  return {
    checkMastra(): Promise<boolean> {
      return new Promise((resolve) => {
        const child = spawn(
          "pnpm",
          ["exec", "mastra", "--version"],
          {
            stdio: "ignore",
            // shell: true — required for Windows PATH lookup; argv is fully-controlled (no user input).
            shell: process.platform === "win32",
          },
        );
        child.on("error", () => resolve(false));
        child.on("close", (code) => resolve(code === 0));
      });
    },
    spawnMastraDev() {
      return spawn("pnpm", ["exec", "mastra", "dev"], {
        stdio: "inherit",
        // shell: true — required for Windows PATH lookup; argv is fully-controlled (no user input).
        shell: process.platform === "win32",
      });
    },
  };
}

/**
 * Start Mastra dev server and print placeholder panel URLs.
 */
export async function runDev(runner: DevRunner = defaultDevRunner()): Promise<number> {
  const hasMastra = await runner.checkMastra();
  if (!hasMastra) {
    console.error(MASTRA_MISSING);
    return 1;
  }

  console.log("Spawning: pnpm exec mastra dev");
  console.log("Panels (Sprint 4 placeholders):");
  for (const url of DEV_PANEL_URLS) {
    console.log(`  ${url}`);
  }

  return new Promise((resolve) => {
    const child = runner.spawnMastraDev();
    child.on("error", () => {
      console.error(MASTRA_MISSING);
      resolve(1);
    });
    child.on("close", (code) => resolve(code ?? 0));
  });
}

export const devCommand = defineCommand({
  meta: {
    name: "dev",
    description: "Local dev server and Mastra panels (panels: Sprint 4)",
  },
  async run() {
    return runDev();
  },
});
