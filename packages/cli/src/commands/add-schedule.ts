/* SPDX-License-Identifier: Apache-2.0 */
import * as clack from "@clack/prompts";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { defineCommand } from "citty";
import { assertPathUnderBase } from "../lib/path-safety.js";

const SAFE_SCHEDULE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SCHEDULE_TARGET_BASE = "schedules";

export type RunAddScheduleOptions = {
  force?: boolean;
  /** @internal Test hook — defaults to clack confirm. */
  confirmOverwrite?: (targetRel: string) => Promise<boolean>;
};

export const addScheduleCommand = defineCommand({
  meta: {
    name: "schedule",
    description: "Scaffold a schedules/<name>.ts file using defineSchedule",
  },
  args: {
    name: {
      type: "positional",
      description: "Schedule name (e.g. weekly-flash-report)",
      required: true,
    },
    force: {
      type: "boolean",
      description:
        "Overwrite schedules/<name>.ts without prompting. Diff before using --force if you customized the file.",
      default: false,
    },
  },
  async run({ args }) {
    return runAddSchedule(args.name, process.cwd(), { force: args.force });
  },
});

/** @internal Exported for integration tests. */
export async function runAddSchedule(
  scheduleName: string,
  cwd: string = process.cwd(),
  options?: RunAddScheduleOptions,
): Promise<number> {
  const nameError = validateScheduleName(scheduleName);
  if (nameError != null) {
    console.error(`add schedule: ${nameError}`);
    return 1;
  }

  const targetDir = resolve(cwd, SCHEDULE_TARGET_BASE);
  mkdirSync(targetDir, { recursive: true });

  const targetFile = join(targetDir, `${scheduleName}.ts`);
  const targetRel = `./${SCHEDULE_TARGET_BASE}/${scheduleName}.ts`;

  try {
    assertPathUnderBase(targetDir, targetFile);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`add schedule: ${message}`);
    return 1;
  }

  if (existsSync(targetFile) && !options?.force) {
    const confirm =
      options?.confirmOverwrite ??
      (async (rel) => {
        const answer = await clack.confirm({
          message: `Overwrite ${rel}?`,
        });
        if (clack.isCancel(answer)) {
          return false;
        }
        return answer === true;
      });
    const ok = await confirm(targetRel);
    if (!ok) {
      return 1;
    }
    writeScheduleFile(targetFile, scheduleName);
    console.log(`✓ Overwrote ${targetRel}`);
    return 0;
  }

  writeScheduleFile(targetFile, scheduleName);
  console.log(`✓ Created ${targetRel}`);
  return 0;
}

function validateScheduleName(name: string): string | null {
  if (!SAFE_SCHEDULE_NAME.test(name)) {
    return `Invalid schedule name "${name}": use lowercase letters, numbers, and hyphens`;
  }
  return null;
}

function writeScheduleFile(path: string, name: string): void {
  const content = [
    'import { defineSchedule } from "@arivie/core";',
    "",
    "export default defineSchedule({",
    `  id: "${name}",`,
    '  cron: "0 9 * * 1", // Monday 09:00 — edit to your cadence',
    `  prompt: "Replace this with the analytical question Arivie should answer on schedule.",`,
    "});",
    "",
  ].join("\n");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}
