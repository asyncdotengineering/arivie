/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { gatePasses } from "./run-eval.js";

describe("navigation eval gate", () => {
  const baseline = { accuracy: 1, mean_input_tokens: 3000 };

  it("passes at equal accuracy with lower input tokens", () => {
    expect(
      gatePasses(baseline, {
        accuracy: 1,
        mean_input_tokens: 2999,
      }),
    ).toBe(true);
  });

  it("fails when navigation accuracy regresses", () => {
    expect(
      gatePasses(baseline, {
        accuracy: 11 / 12,
        mean_input_tokens: 2000,
      }),
    ).toBe(false);
  });

  it("fails when navigation input tokens are not strictly lower", () => {
    expect(
      gatePasses(baseline, {
        accuracy: 1,
        mean_input_tokens: 3000,
      }),
    ).toBe(false);
  });
});
