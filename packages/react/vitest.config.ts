/* SPDX-License-Identifier: Apache-2.0 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // jsdom: MSW + happy-dom locks ReadableStream bodies (happy-dom #1298)
    environment: "jsdom",
    include: ["test/**/*.{test,spec}.{ts,tsx}"],
    setupFiles: ["test/setup.ts"],
    coverage: { provider: "v8" },
  },
});
