/* SPDX-License-Identifier: Apache-2.0 */
import type { ChildProcess } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { DEV_PANEL_URLS, runDev } from "../src/commands/dev.js";

describe("runDev", () => {
  it("spawns pnpm exec mastra dev when mastra is available", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const spawnMastraDev = vi.fn(
      (): Pick<ChildProcess, "on"> =>
        ({
          on(event: string, cb: (code: number) => void) {
            if (event === "close") {
              cb(0);
            }
            return this;
          },
        }) as Pick<ChildProcess, "on">,
    );

    const code = await runDev({
      checkMastra: async () => true,
      spawnMastraDev: spawnMastraDev as unknown as () => ChildProcess,
    });

    expect(code).toBe(0);
    expect(spawnMastraDev).toHaveBeenCalled();
    expect(logSpy.mock.calls[0]?.[0]).toBe("Spawning: pnpm exec mastra dev");
    for (const url of DEV_PANEL_URLS) {
      expect(logSpy.mock.calls.some((c) => c[0] === `  ${url}`)).toBe(true);
    }
    logSpy.mockRestore();
  });

  it("exits 1 when mastra is missing", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = await runDev({
      checkMastra: async () => false,
      spawnMastraDev: () => {
        throw new Error("should not spawn");
      },
    });
    expect(code).toBe(1);
    expect(errSpy.mock.calls[0]?.[0]).toContain("mastra dev required");
    errSpy.mockRestore();
  });
});
