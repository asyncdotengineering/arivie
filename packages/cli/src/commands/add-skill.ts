/* SPDX-License-Identifier: Apache-2.0 */
import * as clack from "@clack/prompts";
import { cp, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineCommand } from "citty";
import { assertPathUnderBase } from "../lib/path-safety.js";
import { findMonorepoRoot } from "../lib/registry-resolve.js";

const SKILLS_PKG = "@arivie/skills";
const SKILLS_TARGET_BASE = "skills";

/** Skill directory names shipped in @arivie/skills (e.g. cohort-analysis). */
const SAFE_SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type RunAddSkillOptions = {
  force?: boolean;
  /** @internal Test hook — defaults to clack confirm. */
  confirmOverwrite?: (targetRel: string) => Promise<boolean>;
};

export const addSkillCommand = defineCommand({
  meta: {
    name: "skill",
    description: "Copy a skill from @arivie/skills into ./skills/<name>/",
  },
  args: {
    name: {
      type: "positional",
      description: "Skill name (e.g. cohort-analysis)",
      required: true,
    },
    force: {
      type: "boolean",
      description:
        "Overwrite ./skills/<name>/ without prompting. Overwrites SKILL.md and matching files in references/; unrelated files in the target directory are preserved. Diff before using --force if you customized those files.",
      default: false,
    },
  },
  async run({ args }) {
    const skillName = args.name;
    if (skillName == null || skillName.length === 0) {
      console.error("add skill: missing skill name");
      return 1;
    }

    return runAddSkill(skillName, process.cwd(), { force: args.force });
  },
});

/** @internal Exported for integration tests. */
export async function runAddSkill(
  skillName: string,
  cwd: string = process.cwd(),
  options?: RunAddSkillOptions,
): Promise<number> {
  const prevCwd = process.cwd();
  process.chdir(cwd);
  try {
    const nameError = validateSkillName(skillName);
    if (nameError != null) {
      console.error(`add skill: ${nameError}`);
      return 1;
    }

    const skillsPkgRoot = resolveSkillsPackageRoot(process.cwd());
    if (skillsPkgRoot == null) {
      console.error("add skill: install @arivie/skills first");
      return 1;
    }

    const sourceDir = join(skillsPkgRoot, skillName);
    const skillMd = join(sourceDir, "SKILL.md");
    if (!existsSync(skillMd)) {
      console.error(
        `add skill: skill "${skillName}" not found in ${SKILLS_PKG} (missing SKILL.md)`,
      );
      return 1;
    }

    const targetDir = resolve(process.cwd(), SKILLS_TARGET_BASE, skillName);
    const targetRel = `./${SKILLS_TARGET_BASE}/${skillName}/`;

    if (existsSync(targetDir) && !options?.force) {
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
    }

    const skillsBase = resolve(process.cwd(), SKILLS_TARGET_BASE);
    try {
      assertPathUnderBase(skillsBase, targetDir);
      assertPathUnderBase(sourceDir, skillMd);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`add skill: ${message}`);
      return 1;
    }

    await mkdir(targetDir, { recursive: true });

    const copyOpts = { recursive: true, force: true as const };
    await cp(skillMd, join(targetDir, "SKILL.md"), copyOpts);
    console.log(`✓ Copied ${targetRel}SKILL.md`);

    const referencesSrc = join(sourceDir, "references");
    if (existsSync(referencesSrc)) {
      const referencesDest = join(targetDir, "references");
      await cp(referencesSrc, referencesDest, copyOpts);
      console.log(`✓ Copied ${targetRel}references/`);
    }

    return 0;
  } finally {
    process.chdir(prevCwd);
  }
}

function validateSkillName(skillName: string): string | null {
  if (!SAFE_SKILL_NAME.test(skillName)) {
    return `Invalid skill name "${skillName}": use lowercase letters, numbers, and hyphens`;
  }
  return null;
}

/**
 * Resolve the skills source root, trying each tier in order.
 *
 * Tier 0 (dev):       `<monorepo>/packages/skills/` (when hacking arivie)
 * Tier 1 (bundled):   `<cli_install>/dist/templates/skills/` (published CLI)
 * Tier 2 (installed): `<cwd>/node_modules/@arivie/skills/` (user opted to
 *                     `pnpm add @arivie/skills` for some reason — kept for
 *                     forward-compat if we ever publish the package)
 *
 * Returns the directory containing per-skill subdirs (each with SKILL.md).
 */
function resolveSkillsPackageRoot(cwd: string): string | null {
  // Tier 0: monorepo
  const monorepoRoot = findMonorepoRoot(cwd);
  if (monorepoRoot != null) {
    const monorepoSkills = join(monorepoRoot, "packages", "skills");
    if (existsSync(monorepoSkills)) return monorepoSkills;
  }

  // Tier 1: bundled into CLI's own install dir.
  // tsup bundles add-skill.ts into either dist/src/index.js or
  // dist/bin/arivie.js — both are one level under dist/. Walk up once.
  try {
    const here = fileURLToPath(import.meta.url);
    const distRoot = resolve(dirname(here), "..");
    const bundled = join(distRoot, "templates", "skills");
    if (existsSync(bundled)) return bundled;
  } catch {
    // fileURLToPath can throw if import.meta.url is somehow unavailable
  }

  // Tier 2: locally-installed npm package (forward-compat)
  const installed = resolve(cwd, "node_modules", "@arivie", "skills");
  if (existsSync(join(installed, "package.json"))) {
    return installed;
  }

  return null;
}
