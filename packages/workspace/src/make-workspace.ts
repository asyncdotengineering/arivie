/* SPDX-License-Identifier: Apache-2.0 */
import fs from "node:fs/promises";
import path from "node:path";
import type { Tool } from "@mastra/core/tools";
import { Workspace } from "@mastra/core/workspace";
import type { Workspace as MastraWorkspace } from "@mastra/core/workspace";
import type { WorkspaceFilesystem } from "@mastra/core/workspace";
import {
  SkillSearchProcessor,
  SkillsProcessor,
} from "@mastra/core/processors";
import type {
  SkillSearchProcessor as SkillSearchProcessorType,
  SkillsProcessor as SkillsProcessorType,
} from "@mastra/core/processors";
import { SemanticLayerFilesystem } from "./filesystem.js";
import {
  workspaceBashTool,
  type SandboxRunCommandFilesystem,
} from "./tools/bash.js";

export interface MakeWorkspaceOptions {
  rootDir?: string;
  filesystem?: WorkspaceFilesystem;
  skills?: string[] | string;
  bm25?: boolean;
  skillsMode?: "eager" | "on-demand" | "auto";
  tools?: ("bash")[];
  finalizeReport?: boolean;
}

export type MakeWorkspaceResult = {
  workspace: MastraWorkspace;
  bashEnabled: boolean;
  bashTool?: Tool;
  skillsProcessor: SkillsProcessorType | SkillSearchProcessorType;
  /**
   * Effective skills presentation mode after resolving `"auto"`:
   *   - `"none"`: no skills attached.
   *   - `"eager"`: skill bodies are auto-injected into prompt (default
   *     for ≤6 skills under `"auto"`).
   *   - `"on-demand"`: `search_skills` / `load_skill` tools surface; the
   *     agent must fetch (default for >6 skills under `"auto"`).
   * Consumed by the prompt builder to decide which SKILL_DISCIPLINE
   * variant to render.
   */
  effectiveSkillsMode: "none" | "eager" | "on-demand";
};

type FilesystemWithUpload = WorkspaceFilesystem & {
  uploadFromHost(hostPath: string, sandboxPath: string): Promise<void>;
};

function filesystemKind(filesystem: WorkspaceFilesystem): string {
  if ("kind" in filesystem && typeof filesystem.kind === "string") {
    return filesystem.kind;
  }
  return "local";
}

function isSandboxedFilesystem(filesystem: WorkspaceFilesystem): boolean {
  return filesystemKind(filesystem) !== "local";
}

function hasUploadFromHost(
  filesystem: WorkspaceFilesystem,
): filesystem is FilesystemWithUpload {
  return (
    isSandboxedFilesystem(filesystem) &&
    "uploadFromHost" in filesystem &&
    typeof filesystem.uploadFromHost === "function"
  );
}

function resolveFilesystem(opts: MakeWorkspaceOptions): WorkspaceFilesystem {
  if (opts.filesystem) {
    return opts.filesystem;
  }
  if (opts.rootDir) {
    return new SemanticLayerFilesystem({ rootDir: opts.rootDir });
  }
  throw new Error("makeWorkspace requires rootDir or filesystem");
}

function normalizeSkillHostPaths(skills?: string[] | string): string[] {
  if (!skills) {
    return [];
  }
  if (typeof skills === "string") {
    return [skills];
  }
  return skills;
}

async function expandSkillHostPaths(hostPaths: string[]): Promise<string[]> {
  const expanded: string[] = [];
  for (const hostPath of hostPaths) {
    const resolved = path.resolve(hostPath);
    let stat;
    try {
      stat = await fs.stat(resolved);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) {
      continue;
    }
    const skillMd = path.join(resolved, "SKILL.md");
    try {
      await fs.access(skillMd);
      expanded.push(resolved);
      continue;
    } catch {
      // Parent directory — discover child skill folders.
    }
    const entries = await fs.readdir(resolved, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const child = path.join(resolved, entry.name);
      try {
        await fs.access(path.join(child, "SKILL.md"));
        expanded.push(child);
      } catch {
        // Not a skill directory.
      }
    }
  }
  return expanded;
}

function sandboxSkillPath(hostSkillDir: string): string {
  const name = path.basename(hostSkillDir);
  return `skills/${name}`;
}

async function uploadSemanticLayer(
  filesystem: FilesystemWithUpload,
  hostRoot: string,
): Promise<void> {
  const catalogHost = path.join(hostRoot, "catalog.yml");
  try {
    await fs.access(catalogHost);
    await filesystem.uploadFromHost(catalogHost, "catalog.yml");
  } catch {
    // No catalog at host root.
  }

  const entitiesDir = path.join(hostRoot, "entities");
  let entries;
  try {
    entries = await fs.readdir(entitiesDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".yml")) {
      continue;
    }
    const hostPath = path.join(entitiesDir, entry.name);
    const sandboxPath = `entities/${entry.name}`;
    await filesystem.uploadFromHost(hostPath, sandboxPath);
  }
}

async function uploadSkillDirectory(
  filesystem: FilesystemWithUpload,
  hostSkillDir: string,
): Promise<void> {
  const prefix = sandboxSkillPath(hostSkillDir);
  const skillMd = path.join(hostSkillDir, "SKILL.md");
  try {
    await fs.access(skillMd);
    await filesystem.uploadFromHost(skillMd, `${prefix}/SKILL.md`);
  } catch {
    return;
  }

  const referencesDir = path.join(hostSkillDir, "references");
  let refs;
  try {
    refs = await fs.readdir(referencesDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of refs) {
    if (!entry.isFile()) {
      continue;
    }
    const hostPath = path.join(referencesDir, entry.name);
    await filesystem.uploadFromHost(
      hostPath,
      `${prefix}/references/${entry.name}`,
    );
  }
}

async function uploadSandboxContent(
  filesystem: FilesystemWithUpload,
  hostSemanticRoot: string | undefined,
  skillHostDirs: string[],
): Promise<void> {
  if (hostSemanticRoot) {
    await uploadSemanticLayer(filesystem, hostSemanticRoot);
  }

  for (const hostSkillDir of skillHostDirs) {
    await uploadSkillDirectory(filesystem, hostSkillDir);
  }
}

function resolveHostSemanticRoot(
  opts: MakeWorkspaceOptions,
  filesystem: WorkspaceFilesystem,
): string | undefined {
  if (opts.rootDir) {
    return path.resolve(opts.rootDir);
  }
  if ("basePath" in filesystem && typeof filesystem.basePath === "string") {
    return filesystem.basePath;
  }
  return undefined;
}

function workspaceBm25ForCreate(
  opts: MakeWorkspaceOptions,
  skillHostCount: number,
): boolean {
  if (opts.skillsMode === "on-demand") {
    return true;
  }
  if (opts.bm25 === true) {
    return true;
  }
  if (opts.skillsMode === "auto" && skillHostCount > 6) {
    return true;
  }
  return opts.bm25 ?? false;
}

async function selectSkillsProcessor(
  workspace: MastraWorkspace,
  skillsMode: "eager" | "on-demand" | "auto",
): Promise<{
  processor: SkillsProcessorType | SkillSearchProcessorType;
  effectiveMode: "eager" | "on-demand";
}> {
  const listed = await workspace.skills?.list();
  const count = listed?.length ?? 0;

  let effectiveMode: "eager" | "on-demand" = skillsMode === "auto"
    ? count <= 6
      ? "eager"
      : "on-demand"
    : skillsMode;

  // Surface the auto-mode decision exactly once per boot so debugging
  // unexpected recall behaviour doesn't require source-diving. Honors
  // ARIVIE_QUIET=1 for callers that want a silent boot.
  if (skillsMode === "auto" && process.env.ARIVIE_QUIET !== "1") {
    // eslint-disable-next-line no-console
    console.info(
      `[arivie] skills mode=auto → resolved to "${effectiveMode}" (${count} skill${count === 1 ? "" : "s"} discovered, threshold=6)`,
    );
  }

  if (effectiveMode === "eager") {
    return { processor: new SkillsProcessor({ workspace }), effectiveMode };
  }

  return {
    processor: new SkillSearchProcessor({
      workspace,
      search: { topK: 5, minScore: 0.1 },
    }),
    effectiveMode,
  };
}

/** v2 workspace factory: sandbox uploads, skills resolution, bash scaffolding. */
export async function makeWorkspace(
  opts: MakeWorkspaceOptions,
): Promise<MakeWorkspaceResult> {
  const filesystem = resolveFilesystem(opts);
  const skillsMode = opts.skillsMode ?? "auto";
  const skillHostDirs = await expandSkillHostPaths(
    normalizeSkillHostPaths(opts.skills),
  );

  if (hasUploadFromHost(filesystem)) {
    const hostSemanticRoot = resolveHostSemanticRoot(opts, filesystem);
    await uploadSandboxContent(filesystem, hostSemanticRoot, skillHostDirs);
  }

  const workspaceSkills = isSandboxedFilesystem(filesystem)
    ? skillHostDirs.map((dir) => sandboxSkillPath(dir))
    : skillHostDirs;

  const workspaceConfig: {
    filesystem: WorkspaceFilesystem;
    bm25: boolean;
    skills?: string[];
  } = {
    filesystem,
    bm25: workspaceBm25ForCreate(opts, skillHostDirs.length),
  };
  if (workspaceSkills.length > 0) {
    workspaceConfig.skills = workspaceSkills;
  }

  const workspace = new Workspace(workspaceConfig);

  let bashEnabled = false;
  if (opts.tools?.includes("bash")) {
    if (!isSandboxedFilesystem(filesystem)) {
      throw new Error("workspace_bash requires a sandboxed filesystem");
    }
    bashEnabled = true;
  }

  const { processor: skillsProcessor, effectiveMode } =
    await selectSkillsProcessor(workspace, skillsMode);

  // Reflect "no skills attached" in the effective mode so the prompt
  // builder doesn't render a skill-discipline block that has nothing
  // to discipline.
  const effectiveSkillsMode: "none" | "eager" | "on-demand" =
    skillHostDirs.length === 0 ? "none" : effectiveMode;

  const result: MakeWorkspaceResult = {
    workspace,
    bashEnabled,
    skillsProcessor,
    effectiveSkillsMode,
  };
  if (bashEnabled) {
    result.bashTool = workspaceBashTool({
      filesystem: filesystem as SandboxRunCommandFilesystem,
    }) as Tool;
  }
  return result;
}
