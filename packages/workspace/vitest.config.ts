/* SPDX-License-Identifier: Apache-2.0 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "test/**/*.bench.ts"],
    coverage: {
      provider: "v8",
      include: ["src/filesystems/**/*.ts"],
    },
  },
});
