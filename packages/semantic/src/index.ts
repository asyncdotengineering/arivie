/* SPDX-License-Identifier: Apache-2.0 */
export {
  CatalogSchema,
  ColumnSchema,
  DimensionSchema,
  EntitySchema,
  ExampleQuerySchema,
  JoinSchema,
  MeasureSchema,
  SegmentSchema,
} from "./schema.js";
export type {
  Catalog,
  Column,
  Dimension,
  Entity,
  ExampleQuery,
  Join,
  LintError,
  LintOptions,
  LintReport,
  LintWarning,
  Measure,
  Segment,
  SemanticLayer,
} from "./types.js";
export { parseEntity, type Result } from "./parse.js";
export { defineEntity } from "./define.js";
export { loadSemanticLayer, loadSemanticLayerSync } from "./load.js";
export { estimateTokens, formatLintReport, lint } from "./lint.js";
export { codegen } from "./codegen.js";
/**
 * @internal
 * Test-only helper used by `test/codegen.test.ts` to snapshot the generated
 * source without writing to disk. Not part of the public surface; subject to
 * change without a semver bump.
 */
export { renderGeneratedIndex } from "./codegen.js";
export { LoadError, ParseError } from "./errors.js";
