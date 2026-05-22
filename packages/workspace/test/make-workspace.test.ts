/* SPDX-License-Identifier: Apache-2.0 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SkillSearchProcessor, SkillsProcessor } from "@mastra/core/processors";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  InProcessSandboxFilesystem,
  SemanticLayerFilesystem,
  makeWorkspace,
} from "../src/index.js";

const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
);
const sandboxSemanticDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures/sandbox-rootDir",
);

async function writeSkillDir(
  root: string,
  name: string,
  withReference = false,
): Promise<string> {
  const dir = path.join(root, name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: test skill\n---\n# ${name}\n`,
  );
  if (withReference) {
    const refs = path.join(dir, "references");
    await fs.mkdir(refs, { recursive: true });
    await fs.writeFile(path.join(refs, "notes.md"), "reference body");
  }
  return dir;
}

describe("makeWorkspace", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "arivie-mkw-"));
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("constructs workspace from rootDir only", async () => {
    await fs.cp(fixturesDir, tempRoot, { recursive: true });
    const { workspace } = await makeWorkspace({ rootDir: tempRoot });
    expect(workspace.filesystem).toBeInstanceOf(SemanticLayerFilesystem);
    const content = await workspace.filesystem.readFile("sample.txt", {
      encoding: "utf8",
    });
    expect(content).toBe("arivie workspace fixture\n");
  });

  it("constructs workspace from filesystem only", async () => {
    await fs.cp(fixturesDir, tempRoot, { recursive: true });
    const filesystem = new SemanticLayerFilesystem({ rootDir: tempRoot });
    const { workspace } = await makeWorkspace({ filesystem });
    expect(workspace.filesystem).toBe(filesystem);
  });

  it("throws when neither rootDir nor filesystem is provided", async () => {
    await expect(makeWorkspace({})).rejects.toThrow(
      /requires rootDir or filesystem/,
    );
  });

  it("uploads semantic layer files into a sandboxed filesystem", async () => {
    const hostSemantic = path.join(tempRoot, "semantic-host");
    await fs.cp(sandboxSemanticDir, hostSemantic, { recursive: true });
    const sandboxRoot = path.join(tempRoot, "sandbox");
    await fs.mkdir(sandboxRoot, { recursive: true });

    const filesystem = new InProcessSandboxFilesystem({ rootDir: sandboxRoot });
    const uploadSpy = vi.spyOn(filesystem, "uploadFromHost");

    await makeWorkspace({
      rootDir: hostSemantic,
      filesystem,
    });

    expect(uploadSpy).toHaveBeenCalledWith(
      path.join(hostSemantic, "catalog.yml"),
      "catalog.yml",
    );
    expect(uploadSpy).toHaveBeenCalledWith(
      path.join(hostSemantic, "entities", "orders.yml"),
      "entities/orders.yml",
    );
    expect(uploadSpy).toHaveBeenCalledWith(
      path.join(hostSemantic, "entities", "customers.yml"),
      "entities/customers.yml",
    );
  });

  it("rejects bash tool registration on local filesystem", async () => {
    await fs.cp(fixturesDir, tempRoot, { recursive: true });
    await expect(
      makeWorkspace({
        rootDir: tempRoot,
        tools: ["bash"],
      }),
    ).rejects.toThrow(/workspace_bash requires a sandboxed filesystem/);
  });

  it("returns bashTool when bash is opted in on sandboxed filesystem", async () => {
    const sandboxRoot = path.join(tempRoot, "sandbox");
    await fs.mkdir(sandboxRoot, { recursive: true });
    const filesystem = new InProcessSandboxFilesystem({ rootDir: sandboxRoot });

    const { bashEnabled, bashTool } = await makeWorkspace({
      filesystem,
      tools: ["bash"],
    });

    expect(bashEnabled).toBe(true);
    expect(bashTool).toBeDefined();
    expect(bashTool!.id).toBe("workspace_bash");
  });

  it("uploads SKILL.md and references for resolved skills", async () => {
    const hostSemantic = path.join(tempRoot, "semantic-host");
    await fs.cp(sandboxSemanticDir, hostSemantic, { recursive: true });
    const skillsHost = path.join(tempRoot, "skills-host");
    const alphaDir = await writeSkillDir(skillsHost, "alpha", true);

    const sandboxRoot = path.join(tempRoot, "sandbox");
    await fs.mkdir(sandboxRoot, { recursive: true });
    const filesystem = new InProcessSandboxFilesystem({ rootDir: sandboxRoot });
    const uploadSpy = vi.spyOn(filesystem, "uploadFromHost");

    await makeWorkspace({
      rootDir: hostSemantic,
      filesystem,
      skills: skillsHost,
    });

    expect(uploadSpy).toHaveBeenCalledWith(
      path.join(alphaDir, "SKILL.md"),
      "skills/alpha/SKILL.md",
    );
    expect(uploadSpy).toHaveBeenCalledWith(
      path.join(alphaDir, "references", "notes.md"),
      "skills/alpha/references/notes.md",
    );
  });

  it("selects SkillsProcessor for auto mode with at most six skills", async () => {
    await fs.cp(fixturesDir, tempRoot, { recursive: true });
    const skillDirs: string[] = [];
    for (let i = 0; i < 6; i++) {
      skillDirs.push(await writeSkillDir(tempRoot, `skill-${i}`));
    }

    const { skillsProcessor } = await makeWorkspace({
      rootDir: tempRoot,
      skills: skillDirs,
      skillsMode: "auto",
    });

    expect(skillsProcessor).toBeInstanceOf(SkillsProcessor);
  });

  it("selects SkillSearchProcessor for auto mode with more than six skills", async () => {
    await fs.cp(fixturesDir, tempRoot, { recursive: true });
    const skillDirs: string[] = [];
    for (let i = 0; i < 7; i++) {
      skillDirs.push(await writeSkillDir(tempRoot, `skill-${i}`));
    }

    const { skillsProcessor } = await makeWorkspace({
      rootDir: tempRoot,
      skills: skillDirs,
      skillsMode: "auto",
    });

    expect(skillsProcessor).toBeInstanceOf(SkillSearchProcessor);
  });

  it("selects SkillsProcessor for auto mode with zero skills", async () => {
    await fs.cp(fixturesDir, tempRoot, { recursive: true });
    const { skillsProcessor } = await makeWorkspace({
      rootDir: tempRoot,
      skillsMode: "auto",
    });

    expect(skillsProcessor).toBeInstanceOf(SkillsProcessor);
  });

  it("selects SkillsProcessor for eager mode regardless of skill count", async () => {
    await fs.cp(fixturesDir, tempRoot, { recursive: true });
    const skillDirs: string[] = [];
    for (let i = 0; i < 10; i++) {
      skillDirs.push(await writeSkillDir(tempRoot, `eager-skill-${i}`));
    }

    const { skillsProcessor } = await makeWorkspace({
      rootDir: tempRoot,
      skills: skillDirs,
      skillsMode: "eager",
    });

    expect(skillsProcessor).toBeInstanceOf(SkillsProcessor);
  });

  it("selects SkillSearchProcessor for on-demand mode", async () => {
    await fs.cp(fixturesDir, tempRoot, { recursive: true });
    const skillDir = await writeSkillDir(tempRoot, "on-demand-skill");

    const { skillsProcessor } = await makeWorkspace({
      rootDir: tempRoot,
      skills: [skillDir],
      skillsMode: "on-demand",
    });

    expect(skillsProcessor).toBeInstanceOf(SkillSearchProcessor);
  });

  it("resolves skills via Mastra workspace.skills after upload", async () => {
    const hostSemantic = path.join(tempRoot, "semantic-host");
    await fs.cp(sandboxSemanticDir, hostSemantic, { recursive: true });
    const skillsHost = path.join(tempRoot, "skills-host");
    await writeSkillDir(skillsHost, "resolver-skill");

    const sandboxRoot = path.join(tempRoot, "sandbox");
    await fs.mkdir(sandboxRoot, { recursive: true });
    const filesystem = new InProcessSandboxFilesystem({ rootDir: sandboxRoot });

    const { workspace, skillsProcessor } = await makeWorkspace({
      rootDir: hostSemantic,
      filesystem,
      skills: skillsHost,
      skillsMode: "eager",
    });

    const listed = await workspace.skills?.list();
    expect(listed?.map((s) => s.name)).toContain("resolver-skill");
    expect(skillsProcessor).toBeInstanceOf(SkillsProcessor);
  });
});
