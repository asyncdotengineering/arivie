/* SPDX-License-Identifier: Apache-2.0 */
import { ToolError } from "@arivie/db-postgres";
import type { Entity } from "@arivie/semantic";

const MAX_ROWS_PER_SIDE = 10_000;
const DEFAULT_MAX_OUTPUT_ROWS = 100_000;

export interface CrossSourceHashJoinOptions {
  readonly leftRows: Record<string, unknown>[];
  readonly rightRows: Record<string, unknown>[];
  readonly leftEntity: Entity;
  readonly rightEntity: Entity;
  readonly joinOn: { readonly left: string; readonly right: string };
  readonly includePii?: boolean;
  /** Maximum joined row count (default 100_000). */
  readonly maxOutputRows?: number;
}

export interface CrossSourceHashJoinResult {
  readonly rows: Record<string, unknown>[];
  readonly droppedPii: string[];
  readonly droppedRows: number;
}

function joinKey(row: Record<string, unknown>, column: string): string {
  const value = row[column];
  if (value === null || value === undefined) {
    return "\0";
  }
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

/** PII column names from entity metadata, normalised to lowercase for case-insensitive drop. */
function piiColumnNamesLower(leftEntity: Entity, rightEntity: Entity): string[] {
  const names = new Set<string>();
  for (const column of leftEntity.columns ?? []) {
    if (column.pii) {
      names.add(column.name.toLowerCase());
    }
  }
  for (const column of rightEntity.columns ?? []) {
    if (column.pii) {
      names.add(column.name.toLowerCase());
    }
  }
  return [...names].sort();
}

function stripPiiColumns(
  row: Record<string, unknown>,
  piiColumnsLower: ReadonlySet<string>,
): Record<string, unknown> {
  if (piiColumnsLower.size === 0) {
    return row;
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (!piiColumnsLower.has(key.toLowerCase())) {
      out[key] = value;
    }
  }
  return out;
}

function mergeRows(
  leftRow: Record<string, unknown>,
  rightRow: Record<string, unknown>,
): Record<string, unknown> {
  return { ...leftRow, ...rightRow };
}

/**
 * Client-side hash join for cross-source entities (C48).
 * PII columns declared on either entity are dropped by default using
 * case-insensitive key matching (entity `email` drops row key `Email`).
 */
export function crossSourceHashJoin(
  opts: CrossSourceHashJoinOptions,
): CrossSourceHashJoinResult {
  const {
    leftRows,
    rightRows,
    leftEntity,
    rightEntity,
    joinOn,
    includePii,
    maxOutputRows = DEFAULT_MAX_OUTPUT_ROWS,
  } = opts;

  if (leftRows.length > MAX_ROWS_PER_SIDE || rightRows.length > MAX_ROWS_PER_SIDE) {
    throw new ToolError(
      "cross-source-too-large",
      `cross-source join exceeds 10k row guard: left=${leftRows.length} right=${rightRows.length}`,
    );
  }

  const piiColumnsLower = includePii
    ? new Set<string>()
    : new Set(piiColumnNamesLower(leftEntity, rightEntity));
  const droppedPii = includePii ? [] : [...piiColumnsLower].sort();

  const hashLeft = leftRows.length <= rightRows.length;
  const smallRows = hashLeft ? leftRows : rightRows;
  const largeRows = hashLeft ? rightRows : leftRows;
  const smallJoinKey = hashLeft ? joinOn.left : joinOn.right;
  const largeJoinKey = hashLeft ? joinOn.right : joinOn.left;

  const index = new Map<string, Record<string, unknown>[]>();
  for (const row of smallRows) {
    const key = joinKey(row, smallJoinKey);
    const bucket = index.get(key);
    if (bucket === undefined) {
      index.set(key, [row]);
    } else {
      bucket.push(row);
    }
  }

  const rows: Record<string, unknown>[] = [];
  const matchedSmallKeys = new Set<string>();
  let largeUnmatched = 0;

  for (const largeRow of largeRows) {
    const key = joinKey(largeRow, largeJoinKey);
    const matches = index.get(key);
    if (matches === undefined || matches.length === 0) {
      largeUnmatched++;
      continue;
    }
    matchedSmallKeys.add(key);
    for (const smallRow of matches) {
      const merged = hashLeft
        ? mergeRows(smallRow, largeRow)
        : mergeRows(largeRow, smallRow);
      rows.push(stripPiiColumns(merged, piiColumnsLower));
    }
  }

  if (rows.length > maxOutputRows) {
    throw new ToolError(
      "cross-source-output-too-large",
      `cross-source join output exceeds cap: actual=${rows.length} cap=${maxOutputRows}`,
    );
  }

  let smallUnmatched = 0;
  for (const row of smallRows) {
    const key = joinKey(row, smallJoinKey);
    if (!matchedSmallKeys.has(key)) {
      smallUnmatched++;
    }
  }

  return {
    rows,
    droppedPii,
    droppedRows: largeUnmatched + smallUnmatched,
  };
}
