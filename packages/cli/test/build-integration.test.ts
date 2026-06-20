/* SPDX-License-Identifier: Apache-2.0 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "citty";
import { buildCommand } from "../src/commands/build.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = resolve(__dirname, "fixtures", "node-project");

describe("build command integration", () => {
  let tmp: string;
  const originalCwd = process.cwd();

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "arivie-build-int-"));
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(tmp, { recursive: true, force: true });
    await rm(join(fixtureRoot, ".arivie"), { recursive: true, force: true });
  });

  it("builds a Node server artifact", async () => {
    process.chdir(fixtureRoot);
    await mkdir(join(fixtureRoot, "dist"), { recursive: true });

    const result = await runCommand(buildCommand, {
      rawArgs: [
        "--target",
        "node",
        "--output",
        join(tmp, "dist"),
        "--config",
        join(fixtureRoot, "arivie.config.ts"),
      ],
    });

    expect(result.result).toBe(0);
    const artifact = resolve(tmp, "dist", "server.mjs");
    const { access } = await import("node:fs/promises");
    await expect(access(artifact)).resolves.toBeUndefined();
  });
});
