/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli.js";
describe("runCli", () => {
  let errSpy: ReturnType<typeof vi.spyOn>;
  let prevCwd: string;
  let workDir: string;

  beforeEach(async () => {
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    prevCwd = process.cwd();
    workDir = await mkdtemp(join(tmpdir(), "arivie-cli-run-"));
    process.chdir(workDir);
  });

  afterEach(async () => {
    errSpy.mockRestore();
    process.chdir(prevCwd);
    await rm(workDir, { recursive: true, force: true });
  });

  it("exits non-zero for unknown subcommands", async () => {
    const code = await runCli(["nosuch"]);
    expect(code).toBe(1);
  });

  it("propagates non-zero exit from add ui with unknown component", async () => {
    const code = await runCli(["add", "ui", "not-real-component"]);
    expect(code).not.toBe(0);
  });

  it("propagates non-zero exit from add entity with unsafe table name", async () => {
    const code = await runCli(["add", "entity", "../../escape"]);
    expect(code).not.toBe(0);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("only letters, numbers, and underscore"),
    );
  });

  it("returns 0 for init --yes happy path", async () => {
    const code = await runCli(["init", "--yes", "--name=cli-smoke"]);
    expect(code).toBe(0);
  });
});
