/* SPDX-License-Identifier: Apache-2.0 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SkillSearchProcessor, SkillsProcessor } from "@mastra/core/processors";
import type { Workspace } from "@mastra/core/workspace";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeWorkspace } from "../src/index.js";

async function writeSkillDir(root: string, name: string): Promise<string> {
  const dir = path.join(root, name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: test skill\n---\n# ${name}\n`,
  );
  return dir;
}

function workspaceBm25Enabled(workspace: Workspace): boolean {
  const config = (
    workspace as unknown as { _config: { bm25?: boolean | object } }
  )._config;
  return config.bm25 === true || typeof config.bm25 === "object";
}

const skillCounts = [0, 3, 6, 7, 10] as const;
const skillsModes = ["auto", "eager", "on-demand"] as const;

describe("skillsMode processor selection", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "arivie-skills-mode-"));
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  for (const skillsMode of skillsModes) {
    for (const count of skillCounts) {
      it(`${skillsMode} with ${count} skills`, async () => {
        const skillDirs: string[] = [];
        for (let i = 0; i < count; i++) {
          skillDirs.push(await writeSkillDir(tempRoot, `skill-${i}`));
        }

        const { workspace, skillsProcessor } = await makeWorkspace({
          rootDir: tempRoot,
          ...(skillDirs.length > 0 ? { skills: skillDirs } : {}),
          skillsMode,
        });

        const expectSearch =
          skillsMode === "on-demand" ||
          (skillsMode === "auto" && count >= 7);
        const expectBm25 = expectSearch;

        if (expectSearch) {
          expect(skillsProcessor).toBeInstanceOf(SkillSearchProcessor);
        } else {
          expect(skillsProcessor).toBeInstanceOf(SkillsProcessor);
        }

        expect(workspaceBm25Enabled(workspace)).toBe(expectBm25);
      });
    }
  }
});
