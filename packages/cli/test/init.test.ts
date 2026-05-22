/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli.js";
import { writeScaffold } from "../src/commands/init.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures/expected-init");

vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  text: vi
    .fn()
    .mockResolvedValueOnce("interactive-app")
    .mockResolvedValueOnce("postgresql://localhost:5432/interactive")
    .mockResolvedValueOnce("owner-1")
    .mockResolvedValueOnce("Owner One"),
  select: vi.fn().mockResolvedValueOnce("preload"),
  isCancel: vi.fn().mockReturnValue(false),
  cancel: vi.fn(),
}));

describe("init command", () => {
  let workDir: string;
  let prevCwd: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "arivie-init-"));
    prevCwd = process.cwd();
    process.chdir(workDir);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    process.chdir(prevCwd);
    logSpy.mockRestore();
    await rm(workDir, { recursive: true, force: true });
  });

  it("scaffolds --yes --name=foo matching committed fixtures", async () => {
    const code = await runCli(["init", "--yes", "--name=foo"]);
    expect(code).toBe(0);

    const files = [
      "arivie.config.ts",
      "semantic/entities/.gitkeep",
      "app/api/arivie/route.ts",
      ".env.example",
    ] as const;

    for (const file of files) {
      const actual = await readFile(join(workDir, file), "utf8");
      const expected = await readFile(join(FIXTURES, file), "utf8");
      expect(actual).toBe(expected);
    }
  });

  it("produces parseable TypeScript scaffold files", async () => {
    await runCli(["init", "--yes", "--name=foo"]);

    for (const file of ["arivie.config.ts", "app/api/arivie/route.ts"]) {
      const source = await readFile(join(workDir, file), "utf8");
      const output = ts.transpileModule(source, {
        reportDiagnostics: true,
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
        },
      });
      const errors = (output.diagnostics ?? []).filter(
        (d) => d.category === ts.DiagnosticCategory.Error,
      );
      expect(errors).toEqual([]);
    }
  });

  it("interactive path uses canned clack prompts", async () => {
    const code = await runCli(["init"]);
    expect(code).toBe(0);

    const config = await readFile(join(workDir, "arivie.config.ts"), "utf8");
    expect(config).toContain("interactive-app");
    expect(config).toContain("owner-1");
    expect(config).toContain('"preload"');

    const env = await readFile(join(workDir, ".env.example"), "utf8");
    expect(env).toContain("interactive-app");
    expect(env).toContain("postgresql://localhost:5432/interactive");
  });

  it("rejects invalid init enum with usage and non-zero exit", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = await runCli(["init", "--yes", "--mode=bogus"]);
    expect(code).toBe(1);
    errSpy.mockRestore();
  });
});

describe("writeScaffold", () => {
  it("writes four files under the target directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "arivie-write-"));
    await writeScaffold(dir, {
      projectName: "demo",
      dbUrl: "postgresql://localhost:5432/arivie",
      ownerId: "dogfood-test",
      ownerName: "Test Owner",
      mode: "auto",
    });
    const config = await readFile(join(dir, "arivie.config.ts"), "utf8");
    expect(config).toContain("demo");
    await rm(dir, { recursive: true, force: true });
  });
});
