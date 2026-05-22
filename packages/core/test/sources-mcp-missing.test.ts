/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { ArivieConfigError } from "../src/errors.js";
import { wrapMcpImportError } from "../src/sources.js";

describe("wrapMcpImportError", () => {
  it("throws ArivieConfigError with install hint on ERR_MODULE_NOT_FOUND", () => {
    const err = Object.assign(
      new Error(
        "Cannot find package '@arivie/source-mcp' imported from sources.ts",
      ),
      { code: "ERR_MODULE_NOT_FOUND" },
    );

    expect(() => wrapMcpImportError(err)).toThrow(ArivieConfigError);
    expect(() => wrapMcpImportError(err)).toThrow(/pnpm add @arivie\/source-mcp/);

    try {
      wrapMcpImportError(err);
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(ArivieConfigError);
      expect((thrown as ArivieConfigError).cause).toBe(err);
    }
  });

  it("re-throws non-module-not-found errors unchanged", () => {
    const err = new Error("connection refused");
    expect(() => wrapMcpImportError(err)).toThrow(err);
  });
});
