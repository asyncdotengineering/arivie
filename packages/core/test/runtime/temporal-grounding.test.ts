/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { temporalGrounding } from "../../src/runtime/temporal-grounding.js";

describe("temporalGrounding", () => {
  it("parameterizes the clock for per-turn delivery", () => {
    const text = temporalGrounding(new Date("2026-06-15T12:00:00.000Z"));
    expect(text).toContain("Now is 2026-06-15T12:00:00.000Z (UTC)");
    expect(text).toContain("today is 2026-06-15");
  });
});