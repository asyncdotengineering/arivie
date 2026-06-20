/* SPDX-License-Identifier: Apache-2.0 */
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateNodeServerEntry } from "../src/lib/build-plugin-node.js";

describe("generateNodeServerEntry", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "arivie-build-"));
  });

  afterEach(async () => {
    await import("node:fs/promises").then(({ rm }) => rm(tmp, { recursive: true, force: true }));
  });

  it("generates an entry that imports the config and serves", async () => {
    await mkdir(join(tmp, "dist"), { recursive: true });
    const configPath = join(tmp, "arivie.config.ts");
    await writeFile(configPath, `export default {};`);

    const source = generateNodeServerEntry({
      configPath,
      rootDir: tmp,
      outputDir: join(tmp, "dist"),
    });

    expect(source).toContain(`import arivieConfig from ${JSON.stringify(configPath.replace(/\\/g, "/"))}`);
    expect(source).toContain(`from "@arivie/core/server"`);
    expect(source).toContain(`from "@hono/node-server"`);
    expect(source).toContain(`createArivieServer`);
    expect(source).toContain(`serve({`);
  });

  it("prefers an exported instance over raw config", () => {
    const source = generateNodeServerEntry({
      configPath: "/project/arivie.config.ts",
      rootDir: "/project",
      outputDir: "/project/dist",
    });
    expect(source).toContain("isArivieInstance");
    expect(source).toContain("defineArivie");
  });
});
