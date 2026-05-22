/* SPDX-License-Identifier: Apache-2.0 */
import { defineConfig } from "tsup";
import base from "../../tsup.base.ts";

export default defineConfig({
  ...base,
  entry: ["src/index.ts"],
  external: ["dockerode", "@vercel/sandbox", "ssh2", "cpu-features"],
});
