/* SPDX-License-Identifier: Apache-2.0 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileTool } from "@mastra/core/workspace";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  InProcessSandboxFilesystem,
  makeWorkspace,
} from "../src/index.js";

const sem5FixturePath = path.join(
  fileURLToPath(new URL("../../agent/test/fixtures/sem-5", import.meta.url)),
);
const skillsPackagePath = path.join(
  fileURLToPath(new URL("../../skills", import.meta.url)),
);

const EXPECTED_SKILL_NAMES = [
  "cohort-analysis",
  "funnel-conversion",
  "churn-investigation",
  "revenue-attribution",
  "anomaly-detection",
  "dau-mau-ratio",
] as const;

const cohortSkillHostPath = path.join(
  skillsPackagePath,
  "cohort-analysis",
  "SKILL.md",
);

async function readViaMastraWorkspaceTool(
  workspace: Awaited<ReturnType<typeof makeWorkspace>>["workspace"],
  filePath: string,
): Promise<string> {
  const result = await readFileTool.execute!(
    { path: filePath },
    { workspace } as Parameters<NonNullable<typeof readFileTool.execute>>[1],
  );
  if (typeof result === "string") {
    return result;
  }
  if (
    result != null &&
    typeof result === "object" &&
    "text" in result &&
    typeof (result as { text: unknown }).text === "string"
  ) {
    return (result as { text: string }).text;
  }
  return String(result);
}

describe("sandboxed skills upload (v02-S3-04)", () => {
  let tempRoot: string;
  let sandboxRoot: string;
  let hostCohortSkillBody: string;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "arivie-sbx-skills-"));
    sandboxRoot = path.join(tempRoot, "sandbox");
    await fs.mkdir(sandboxRoot, { recursive: true });
    hostCohortSkillBody = await fs.readFile(cohortSkillHostPath, "utf8");
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("uploads all six @arivie/skills and reads cohort-analysis via workspace API", async () => {
    const filesystem = new InProcessSandboxFilesystem({ rootDir: sandboxRoot });

    const { workspace } = await makeWorkspace({
      filesystem,
      rootDir: sem5FixturePath,
      skills: [skillsPackagePath],
    });

    for (const name of EXPECTED_SKILL_NAMES) {
      const skillPath = `./skills/${name}/SKILL.md`;
      const body = await filesystem.readFile(skillPath, { encoding: "utf8" });
      expect(body.length).toBeGreaterThan(0);
      expect(body).toContain(`name: ${name}`);
    }

    const cohortViaFilesystem = await filesystem.readFile(
      "./skills/cohort-analysis/SKILL.md",
      { encoding: "utf8" },
    );
    expect(cohortViaFilesystem).toBe(hostCohortSkillBody);
    expect(cohortViaFilesystem).toContain("# Cohort analysis playbook");

    const listed = await workspace.skills?.list();
    expect(listed?.length).toBe(6);
    for (const name of EXPECTED_SKILL_NAMES) {
      expect(listed?.map((s) => s.name)).toContain(name);
    }

    const cohortViaMastra = await readViaMastraWorkspaceTool(
      workspace,
      "./skills/cohort-analysis/SKILL.md",
    );
    expect(cohortViaMastra).toContain("name: cohort-analysis");
    expect(cohortViaMastra).toContain("# Cohort analysis playbook");
    expect(cohortViaMastra).toContain("Compute cohort retention curves");
    for (const line of hostCohortSkillBody.split("\n").slice(0, 5)) {
      if (line.trim().length > 0) {
        expect(cohortViaMastra).toContain(line.trim());
      }
    }
  });
});
