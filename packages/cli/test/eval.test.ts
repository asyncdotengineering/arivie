/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli.js";
import { runEvalCommand } from "../src/commands/eval.js";
import { ARIVIE_MONOREPO_ROOT } from "../src/lib/arivie-root.js";

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
    const code = await runCli(["eval", "--config", missingConfig]);
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
  it("validates the config then invokes the gate runner (no mode)", async () => {
    const runner = { run: vi.fn().mockResolvedValue(0) };
    const code = await runEvalCommand(
      join(ARIVIE_MONOREPO_ROOT, "packages/cli/test/fixtures/setup-config/arivie.config.ts"),
      runner,
    );
    expect(code).toBe(0);
    expect(runner.run).toHaveBeenCalledWith();
  });

  it("returns non-zero when the config cannot be loaded", async () => {
    const runner = { run: vi.fn().mockResolvedValue(0) };
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = await runEvalCommand(join(tmpdir(), "missing-arivie.config.ts"), runner);
    expect(code).toBe(1);
    expect(runner.run).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
