/* SPDX-License-Identifier: Apache-2.0 */
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAddSkill } from "../src/commands/add-skill.js";

async function scaffoldConsumerWithSkill(
  root: string,
  skillName: string,
  options?: { references?: boolean },
): Promise<void> {
  const pkgRoot = join(root, "node_modules", "@arivie", "skills");
  const skillDir = join(pkgRoot, skillName);
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    join(pkgRoot, "package.json"),
    JSON.stringify({ name: "@arivie/skills", version: "0.0.0" }),
    "utf8",
  );
  await writeFile(
    join(skillDir, "SKILL.md"),
    `---\nname: ${skillName}\n---\n# ${skillName}\n`,
    "utf8",
  );
  if (options?.references) {
    await mkdir(join(skillDir, "references"), { recursive: true });
    await writeFile(
      join(skillDir, "references", "schema.md"),
      "# schema\n",
      "utf8",
    );
  }
}

describe("runAddSkill", () => {
  let workDir: string;
  let errSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "arivie-add-skill-"));
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    errSpy.mockRestore();
    logSpy.mockRestore();
    await rm(workDir, { recursive: true, force: true });
  });

  it("copies SKILL.md and references from node_modules/@arivie/skills", async () => {
    await scaffoldConsumerWithSkill(workDir, "cohort-analysis", {
      references: true,
    });

    const code = await runAddSkill("cohort-analysis", workDir);
    expect(code).toBe(0);

    const skillMd = await readFile(
      join(workDir, "skills", "cohort-analysis", "SKILL.md"),
      "utf8",
    );
    expect(skillMd).toContain("name: cohort-analysis");

    await access(
      join(workDir, "skills", "cohort-analysis", "references", "schema.md"),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("./skills/cohort-analysis/SKILL.md"),
    );
  });

  it("errors when @arivie/skills is not installed", async () => {
    const code = await runAddSkill("cohort-analysis", workDir);
    expect(code).toBe(1);
    expect(errSpy).toHaveBeenCalledWith(
      "add skill: install @arivie/skills first",
    );
  });

  it("errors when skill is missing from the package", async () => {
    const pkgRoot = join(workDir, "node_modules", "@arivie", "skills");
    await mkdir(pkgRoot, { recursive: true });
    await writeFile(
      join(pkgRoot, "package.json"),
      JSON.stringify({ name: "@arivie/skills" }),
      "utf8",
    );

    const code = await runAddSkill("not-a-skill", workDir);
    expect(code).toBe(1);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('skill "not-a-skill" not found'),
    );
  });

  it("refuses overwrite when target exists and confirm is declined", async () => {
    await scaffoldConsumerWithSkill(workDir, "cohort-analysis");
    await runAddSkill("cohort-analysis", workDir);

    const dest = join(workDir, "skills", "cohort-analysis", "SKILL.md");
    await writeFile(dest, "# user customized\n", "utf8");

    const code = await runAddSkill("cohort-analysis", workDir, {
      confirmOverwrite: async () => false,
    });
    expect(code).toBe(1);

    const body = await readFile(dest, "utf8");
    expect(body).toContain("user customized");
  });

  it("overwrites silently with --force", async () => {
    await scaffoldConsumerWithSkill(workDir, "cohort-analysis");
    await runAddSkill("cohort-analysis", workDir);

    const dest = join(workDir, "skills", "cohort-analysis", "SKILL.md");
    await writeFile(dest, "# stale\n", "utf8");

    const code = await runAddSkill("cohort-analysis", workDir, { force: true });
    expect(code).toBe(0);

    const body = await readFile(dest, "utf8");
    expect(body).toContain("name: cohort-analysis");
    expect(body).not.toContain("# stale");
  });
});
