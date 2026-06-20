/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { buildCommand } from "../src/commands/build.js";

describe("buildCommand", () => {
  it("has a run function", () => {
    expect(typeof buildCommand.run).toBe("function");
  });
});
