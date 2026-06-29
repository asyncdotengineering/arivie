/* SPDX-License-Identifier: Apache-2.0 */
import { defineConfig } from "tsup";
import base from "../../tsup.base.ts";

export default defineConfig({
  ...base,
  entry: ["src/index.ts", "src/next.ts", "src/stdio.ts", "src/mcp-stdio.ts"],
});
