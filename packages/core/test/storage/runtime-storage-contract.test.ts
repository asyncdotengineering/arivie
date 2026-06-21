/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import {
  assertStorageContract,
  InMemoryRuntimeStorage,
} from "../../src/storage/index.js";

describe("runtime storage contract — in-memory", () => {
  it("passes the full storage contract", async () => {
    await expect(
      assertStorageContract(() => new InMemoryRuntimeStorage()),
    ).resolves.toBeUndefined();
  });
});
