/* SPDX-License-Identifier: Apache-2.0 */
import { execSync } from "node:child_process";
import { copyFile, mkdir } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { defineCommand } from "citty";
import {
  findMonorepoRoot,
  registryNotFoundMessage,
  resolveRegistryComponent,
} from "../lib/registry-resolve.js";
import { assertPathUnderBase } from "../lib/path-safety.js";

const SHADCN_INIT_HINT =
  "Run `pnpm dlx shadcn@latest init` first, then re-run `arivie add ui <name>`.";

const COMPONENTS_BASE = "components/arivie";

/** @internal Exported for tests. */
export function shadcnOnPath(): boolean {
  try {
    execSync("npx shadcn --help", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function printDependencyHints(item: {
  dependencies: string[];
  shadcnDependencies: string[];
}): void {
  for (const dep of item.dependencies) {
    console.log(`Required: pnpm add ${JSON.stringify(dep)}`);
  }
  if (item.shadcnDependencies.length > 0) {
    console.log(`shadcn: ${item.shadcnDependencies.join(", ")}`);
  }
}

export const addUiCommand = defineCommand({
  meta: {
    name: "ui",
    description: "Copy a registry UI component into ./components/arivie/",
  },
  args: {
    name: {
      type: "positional",
      description: "Registry component name (e.g. agent-chat)",
      required: true,
    },
    force: {
      type: "boolean",
      description: "Overwrite existing files in the consumer project",
      default: false,
    },
  },
  async run({ args }) {
    const componentName = args.name;
    if (componentName == null || componentName.length === 0) {
      console.error("add ui: missing component name");
      return 1;
    }

    return runAddUi(componentName, process.cwd(), { force: args.force });
  },
});

/** @internal Exported for integration tests. */
export async function runAddUi(
  componentName: string,
  cwd: string = process.cwd(),
  options?: { force?: boolean },
): Promise<number> {
    const prevCwd = process.cwd();
    process.chdir(cwd);
    try {
    const resolved = resolveRegistryComponent(componentName, cwd);
    if (resolved == null) {
      console.error(registryNotFoundMessage());
      return 1;
    }

    const monorepoRoot = findMonorepoRoot();
    const source = monorepoRoot != null ? "local monorepo" : "bundled CLI templates";
    console.log(`✓ Resolved registry/${componentName} from ${source}`);

    const { item, fileSources } = resolved;

    if (
      item.shadcnDependencies.length > 0 &&
      (!existsSync(join(process.cwd(), "components.json")) || !shadcnOnPath())
    ) {
      console.error(SHADCN_INIT_HINT);
      return 1;
    }

    const componentsBase = resolve(process.cwd(), COMPONENTS_BASE);

    for (const [consumerPath, sourcePath] of fileSources) {
      const dest = resolve(process.cwd(), consumerPath);
      try {
        assertPathUnderBase(componentsBase, dest);
        assertPathUnderBase(resolved.componentDir, sourcePath);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`add ui: ${message}`);
        return 1;
      }

      await mkdir(dirname(dest), { recursive: true });

      const copyFlags = options?.force
        ? 0
        : constants.COPYFILE_EXCL;

      try {
        await copyFile(sourcePath, dest, copyFlags);
      } catch (err) {
        if (!options?.force && isFileExistsError(err)) {
          console.error(
            `add ui: file exists at ${consumerPath}, use --force to overwrite`,
          );
          return 1;
        }
        throw err;
      }

      console.log(`✓ Copied ${consumerPath}`);
    }

    printDependencyHints(item);
    return 0;
    } finally {
      process.chdir(prevCwd);
    }
}

function isFileExistsError(err: unknown): boolean {
  return (
    err instanceof Error &&
    "code" in err &&
    (err as NodeJS.ErrnoException).code === "EEXIST"
  );
}
