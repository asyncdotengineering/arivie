/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { COMPONENT_DIRS } from "../scripts/registry-schema.js";
import { validateRegistry } from "../scripts/validate-registry.js";

describe("validate-registry", () => {
  it("passes schema + file-existence checks for all 8 components", () => {
    const result = validateRegistry();

    if (!result.ok) {
      throw new Error(result.errors.join("\n"));
    }

    expect(result.componentCount).toBe(COMPONENT_DIRS.length);
    expect(COMPONENT_DIRS).toHaveLength(8);
  });
});
