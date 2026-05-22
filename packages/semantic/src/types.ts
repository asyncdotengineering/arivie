/* SPDX-License-Identifier: Apache-2.0 */
import type { z } from "zod";
import type {
  CatalogSchema,
  ColumnSchema,
  DimensionSchema,
  EntitySchema,
  ExampleQuerySchema,
  JoinSchema,
  MeasureSchema,
  SegmentSchema,
} from "./schema.js";

export type Measure = z.infer<typeof MeasureSchema>;
export type Dimension = z.infer<typeof DimensionSchema>;
export type Segment = z.infer<typeof SegmentSchema>;
export type Join = z.infer<typeof JoinSchema>;
export type Column = z.infer<typeof ColumnSchema>;
export type ExampleQuery = z.infer<typeof ExampleQuerySchema>;
export type Entity = z.infer<typeof EntitySchema>;
export type Catalog = z.infer<typeof CatalogSchema>;

export interface SemanticLayer {
  entities: Map<string, Entity>;
  catalog: Catalog;
}

export type LintSeverity = "error" | "warning";

export interface LintError {
  severity: "error";
  code: string;
  message: string;
  entity?: string;
  filePath?: string;
}

export interface LintWarning {
  severity: "warning";
  code: string;
  message: string;
  entity?: string;
  filePath?: string;
}

export interface LintReport {
  errors: LintError[];
  warnings: LintWarning[];
  stats: {
    totalTokens: number;
    entityCount: number;
    suggestedMode: "preload" | "browse" | "rag";
  };
}

export interface LintOptions {
  /** Preload token budget before suggesting browse mode (default 8000). */
  preloadTokenBudget?: number;
  /** Hard preload limit before suggesting rag mode (default 10000). */
  preloadHardLimit?: number;
}
