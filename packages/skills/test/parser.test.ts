/* SPDX-License-Identifier: Apache-2.0 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LocalSkillSource, Workspace } from "@mastra/core/workspace";
import { describe, expect, it } from "vitest";

const skillsRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const EXPECTED_SKILLS = [
  "cohort-analysis",
  "funnel-conversion",
  "churn-investigation",
  "revenue-attribution",
  "anomaly-detection",
  "dau-mau-ratio",
] as const;

describe("SKILL.md parses via Mastra Workspace skills resolver", () => {
  it.each(EXPECTED_SKILLS.map((name) => [name] as const))(
    "parses %s/SKILL.md without error",
    async (name) => {
      const source = new LocalSkillSource({ basePath: skillsRoot });
      const workspace = new Workspace({
        id: "arivie-skills-parser-test",
        name: "arivie-skills-parser-test",
        skills: [`${name}/SKILL.md`],
        skillSource: source,
      });

      await workspace.init();

      const skill = await workspace.skills?.get(name);
      expect(skill).not.toBeNull();
      expect(skill?.name).toBe(name);
      expect(skill?.description?.length).toBeGreaterThan(0);
      expect(skill?.instructions?.length).toBeGreaterThan(0);
    },
  );
});
