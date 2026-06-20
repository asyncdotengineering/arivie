/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAddSchedule } from "../src/commands/add-schedule.js";

describe("runAddSchedule", () => {
  let workDir: string;
  let errSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "arivie-add-schedule-"));
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    errSpy.mockRestore();
    logSpy.mockRestore();
    await rm(workDir, { recursive: true, force: true });
  });

  it("scaffolds schedules/<name>.ts with defineSchedule", async () => {
    const code = await runAddSchedule("weekly-flash-report", workDir);
    expect(code).toBe(0);

    const body = await readFile(
      join(workDir, "schedules", "weekly-flash-report.ts"),
      "utf8",
    );
    expect(body).toContain('import { defineSchedule } from "@arivie/core";');
    expect(body).toContain('id: "weekly-flash-report"');
    expect(body).toContain('cron: "0 9 * * 1"');
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("./schedules/weekly-flash-report.ts"),
    );
  });

  it("errors for invalid schedule names", async () => {
    const code = await runAddSchedule("Weekly Flash Report", workDir);
    expect(code).toBe(1);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("Invalid schedule name"),
    );
  });

  it("refuses overwrite when target exists and confirm is declined", async () => {
    await runAddSchedule("weekly-flash-report", workDir);
    const dest = join(workDir, "schedules", "weekly-flash-report.ts");
    await writeFile(dest, "// user customized\n", "utf8");

    const code = await runAddSchedule("weekly-flash-report", workDir, {
      confirmOverwrite: async () => false,
    });
    expect(code).toBe(1);

    const body = await readFile(dest, "utf8");
    expect(body).toContain("user customized");
  });

  it("overwrites silently with --force", async () => {
    await runAddSchedule("weekly-flash-report", workDir);
    const dest = join(workDir, "schedules", "weekly-flash-report.ts");
    await writeFile(dest, "// stale\n", "utf8");

    const code = await runAddSchedule("weekly-flash-report", workDir, {
      force: true,
    });
    expect(code).toBe(0);

    const body = await readFile(dest, "utf8");
    expect(body).toContain('import { defineSchedule } from "@arivie/core";');
    expect(body).not.toContain("stale");
  });
});
