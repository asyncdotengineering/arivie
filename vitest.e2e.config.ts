/* SPDX-License-Identifier: Apache-2.0 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/e2e/**/*.test.ts"],
    pool: "forks",
    maxConcurrency: 1,
    testTimeout: 600_000,
    hookTimeout: 600_000,
    teardownTimeout: 120_000,
  },
});
