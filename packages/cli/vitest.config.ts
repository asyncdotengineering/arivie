/* SPDX-License-Identifier: Apache-2.0 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.{test,spec}.{ts,tsx}"],
    testTimeout: 20000,
    coverage: { provider: "v8" },
  },
});
