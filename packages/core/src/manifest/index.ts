/* SPDX-License-Identifier: Apache-2.0 */
export { buildManifest } from "./build.js";
export type { BuildManifestInput } from "./build.js";
export {
  assertManifestValid,
  checkPermissionsDeclared,
  hasFatalDiagnostics,
  mergeUnique,
} from "./validate.js";
export type {
  BuildManifestResult,
  ManifestPluginEntry,
  OwnedRef,
  RuntimeManifest,
} from "./types.js";
