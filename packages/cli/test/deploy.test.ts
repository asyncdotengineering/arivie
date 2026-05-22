/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it, vi } from "vitest";
import { ArivieNotImplementedError } from "@arivie/core";
import { runCli } from "../src/cli.js";
import { runDeploy } from "../src/commands/deploy.js";

describe("deploy", () => {
  it("throws ArivieNotImplementedError with Sprint 5 pointer", () => {
    expect(() => runDeploy("cloudflare-do")).toThrow(ArivieNotImplementedError);
    expect(() => runDeploy("cloudflare-do")).toThrow(/Sprint 5 C32/);
  });

  it("runCli deploy cloudflare-do exits 1 and prints pointer to stderr", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = await runCli(["deploy", "cloudflare-do"]);
    expect(code).toBe(1);
    expect(errSpy.mock.calls[0]?.[0]).toContain("Sprint 5 C32");
    expect(errSpy.mock.calls[0]?.[0]).toContain("@arivie/deploy");
    errSpy.mockRestore();
  });
});
