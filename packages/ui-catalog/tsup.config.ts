/* SPDX-License-Identifier: Apache-2.0 */
import { defineConfig } from "tsup";
import baseConfig from "../../tsup.base.ts";

export default defineConfig({
  ...baseConfig,
  entry: ["src/index.ts"],
});
