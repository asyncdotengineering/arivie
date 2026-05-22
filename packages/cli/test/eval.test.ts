/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli.js";
import { runEvalCommand } from "../src/commands/eval.js";
import { resolveEvalMode } from "../src/lib/resolve-eval-mode.js";
import { ARIVIE_MONOREPO_ROOT } from "../src/lib/arivie-root.js";
describe("resolveEvalMode", () => {
  it("uses explicit CLI mode over config", async () => {
    const mode = await resolveEvalMode(
      join(ARIVIE_MONOREPO_ROOT, "packages/cli/test/fixtures/setup-config/arivie.config.ts"),
      "indexed",
    );
    expect(mode).toBe("indexed");
  });

  it("still validates config when --mode is explicit", async () => {
    await expect(
      resolveEvalMode(join(tmpdir(), "missing-arivie.config.ts"), "preload"),
    ).rejects.toThrow();
  });

  it("reads preload from setup fixture config", async () => {
    const mode = await resolveEvalMode(
      join(ARIVIE_MONOREPO_ROOT, "packages/cli/test/fixtures/setup-config/arivie.config.ts"),
    );
    expect(mode).toBe("preload");
  });
});

describe("runCli eval config validation", () => {
  let errSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let workDir: string;
  let prevCwd: string;

  beforeEach(async () => {
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    prevCwd = process.cwd();
    workDir = await mkdtemp(join(tmpdir(), "arivie-eval-cli-"));
    process.chdir(workDir);
  });

  afterEach(async () => {
    errSpy.mockRestore();
    logSpy.mockRestore();
    process.chdir(prevCwd);
    await rm(workDir, { recursive: true, force: true });
  });

  it("exits non-zero with friendly error when config is missing", async () => {
    const missingConfig = join(workDir, "missing.config.ts");
    const code = await runCli(["eval", "--config", missingConfig, "--mode", "preload"]);
    expect(code).not.toBe(0);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringMatching(/Arivie eval failed:/),
    );
    const messages = errSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(messages.some((m: string) => m.includes("Error:") && m.includes("at "))).toBe(
      false,
    );
  });
});

describe("runEvalCommand", () => {
  it("invokes runner with --mode preload", async () => {
    const runner = { run: vi.fn().mockResolvedValue(0) };
    const code = await runEvalCommand(
      join(ARIVIE_MONOREPO_ROOT, "packages/cli/test/fixtures/setup-config/arivie.config.ts"),
      "preload",
      runner,
    );
    expect(code).toBe(0);
    expect(runner.run).toHaveBeenCalledWith("preload");
  });

  it("wires indexed mode", async () => {
    const runner = { run: vi.fn().mockResolvedValue(0) };
    await runEvalCommand(
      join(ARIVIE_MONOREPO_ROOT, "packages/cli/test/fixtures/setup-config/arivie.config.ts"),
      "indexed",
      runner,
    );
    expect(runner.run).toHaveBeenCalledWith("indexed");
  });
});
