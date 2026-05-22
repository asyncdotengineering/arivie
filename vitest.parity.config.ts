/* SPDX-License-Identifier: Apache-2.0 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts"],
    pool: "forks",
    maxConcurrency: 1,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    teardownTimeout: 30_000,
  },
});
