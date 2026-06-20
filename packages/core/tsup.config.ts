/* SPDX-License-Identifier: Apache-2.0 */
import { defineConfig } from "tsup";
import baseConfig from "../../tsup.base.ts";

// errors.ts dropped from sharedEntries — after moving ArivieBoundaryError
// definition INTO core, the standalone /errors subpath collides with the
// main bundle (TS5055: overwrite). db-postgres now imports from the main
// `@arivie/core` entry, which has no cycle since core's main DTS no longer
// depends on db-postgres.
const sharedEntries = [
  "src/context.ts",
  "src/public-types.ts",
  "src/eval/index.ts",
  "src/server/index.ts",
  "src/triggers/index.ts",
];
const mainEntries = ["src/index.ts"];

function resolveEntries(): string[] {
  if (process.env.ARIVIE_BUILD_DTS_SHARED === "1") {
    return sharedEntries;
  }
  if (process.env.ARIVIE_SKIP_DTS === "1") {
    return [...sharedEntries, ...mainEntries];
  }
  return mainEntries;
}

export default defineConfig({
  ...baseConfig,
  dts: process.env.ARIVIE_SKIP_DTS !== "1",
  entry: resolveEntries(),
});
