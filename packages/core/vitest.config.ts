/* SPDX-License-Identifier: Apache-2.0 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    pool: "forks",
    maxConcurrency: 1,
    sequence: {
      concurrent: false,
    },
    teardownTimeout: 30_000,
    hookTimeout: 120_000,
    coverage: {
      provider: "v8",
    },
  },
});
