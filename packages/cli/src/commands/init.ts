/* SPDX-License-Identifier: Apache-2.0 */
import * as clack from "@clack/prompts";
import { defineCommand } from "citty";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  arivieConfigTemplate,
  entitiesGitkeepTemplate,
  envExampleTemplate,
  routeTemplate,
  type InitScaffoldOptions,
  type SemanticMode,
} from "../scaffold.js";

const DEFAULTS = {
  projectName: "arivie-app",
  dbUrl: "postgresql://localhost:5432/arivie",
  ownerId: "dogfood-test",
  ownerName: "Test Owner",
  mode: "auto" as SemanticMode,
};

const MODE_OPTIONS: { value: SemanticMode; label: string }[] = [
  { value: "auto", label: "Auto-detect (recommended)" },
  { value: "preload", label: "Preload (<30 entities)" },
  { value: "indexed", label: "Indexed (30+ entities, workspace navigation)" },
];

export const initCommand = defineCommand({
  meta: {
    name: "init",
    description: "Initialise Arivie in an existing project",
  },
  args: {
    yes: {
      type: "boolean",
      description: "Use defaults; non-interactive",
      default: false,
    },
    name: {
      type: "string",
      description: "Project name",
    },
    dbUrl: {
      type: "string",
      description: "Postgres connection URL",
      alias: ["db-url"],
    },
    ownerId: {
      type: "string",
      description: "Owner / tenant id",
      alias: ["owner-id"],
    },
    ownerName: {
      type: "string",
      description: "Owner display name",
      alias: ["owner-name"],
    },
    mode: {
      type: "enum",
      description: "Semantic context-loading mode",
      options: ["auto", "preload", "indexed"],
    },
  },
  async run({ args }) {
    const opts = await resolveInitOptions(args);
    await writeScaffold(process.cwd(), opts);
    printSummary();
    return 0;
  },
});

async function resolveInitOptions(args: {
  yes: boolean;
  name?: string | undefined;
  dbUrl?: string | undefined;
  ownerId?: string | undefined;
  ownerName?: string | undefined;
  mode?: SemanticMode | undefined;
}): Promise<InitScaffoldOptions> {
  if (args.yes) {
    return {
      projectName: args.name ?? DEFAULTS.projectName,
      dbUrl: args.dbUrl ?? DEFAULTS.dbUrl,
      ownerId: args.ownerId ?? DEFAULTS.ownerId,
      ownerName: args.ownerName ?? DEFAULTS.ownerName,
      mode: args.mode ?? DEFAULTS.mode,
    };
  }

  clack.intro("Arivie — agentic analytics, single-tenant, on Mastra");

  const projectName = await promptText("Project name?", args.name, DEFAULTS.projectName);
  const dbUrl = await promptText(
    "DATABASE_URL?",
    args.dbUrl,
    DEFAULTS.dbUrl,
  );
  const ownerId = await promptText("Owner id?", args.ownerId, DEFAULTS.ownerId);
  const ownerName = await promptText(
    "Owner display name?",
    args.ownerName,
    DEFAULTS.ownerName,
  );
  const mode = await promptMode(args.mode);

  clack.outro("Scaffold complete.");

  return { projectName, dbUrl, ownerId, ownerName, mode };
}

async function promptText(
  message: string,
  preset: string | undefined,
  fallback: string,
): Promise<string> {
  if (preset !== undefined) {
    return preset;
  }
  const value = await clack.text({ message, defaultValue: fallback });
  if (clack.isCancel(value)) {
    clack.cancel("Cancelled.");
    process.exit(1);
  }
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

async function promptMode(preset: SemanticMode | undefined): Promise<SemanticMode> {
  if (preset !== undefined) {
    return preset;
  }
  const value = await clack.select({
    message: "Context-loading mode?",
    options: MODE_OPTIONS,
    initialValue: DEFAULTS.mode,
  });
  if (clack.isCancel(value)) {
    clack.cancel("Cancelled.");
    process.exit(1);
  }
  return value as SemanticMode;
}

export async function writeScaffold(
  cwd: string,
  opts: InitScaffoldOptions,
): Promise<void> {
  const files: { rel: string; content: string }[] = [
    { rel: "arivie.config.ts", content: arivieConfigTemplate(opts) },
    { rel: "semantic/entities/.gitkeep", content: entitiesGitkeepTemplate() },
    { rel: "app/api/arivie/route.ts", content: routeTemplate() },
    { rel: ".env.example", content: envExampleTemplate(opts) },
  ];

  for (const { rel, content } of files) {
    const abs = join(cwd, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
  }
}

function printSummary(): void {
  console.log("✓ Created arivie.config.ts");
  console.log("✓ Created semantic/entities/.gitkeep");
  console.log("✓ Created app/api/arivie/route.ts");
  console.log("✓ Created .env.example");
  console.log("Next: pnpm i @arivie/core @arivie/db-postgres @ai-sdk/anthropic");
  console.log("      then: arivie setup");
}
