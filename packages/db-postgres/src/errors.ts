/* SPDX-License-Identifier: Apache-2.0 */

// ArivieBoundaryError now lives in @arivie/core/errors (moved to break the
// core ↔ db-postgres circular dep). Re-exported here so existing db-postgres
// consumers keep working without an extra import path change.
export { ArivieBoundaryError } from "@arivie/core/types";

export type ToolErrorKind =
  | "sql-invalid"
  | "sql-blocked"
  | "sql-permission-denied"
  | "sql-timeout"
  | "metric-not-found"
  | "metric-ambiguous"
  | "dimension-not-found"
  | "segment-not-found"
  | "join-ambiguous"
  | "filter-invalid"
  | "cross-source-too-large"
  | "cross-source-output-too-large"
  | "cross-source-not-wired"
  | "source-not-found"
  | "source-no-compile"
  | "join-invalid";

export class ToolError extends Error {
  readonly code = "ARIVIE_TOOL_ERROR" as const;

  constructor(
    readonly kind: ToolErrorKind,
    message?: string,
  ) {
    super(message ?? kind);
    this.name = "ToolError";
  }
}
