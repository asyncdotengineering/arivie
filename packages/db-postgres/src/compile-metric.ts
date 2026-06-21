/* SPDX-License-Identifier: Apache-2.0 */
import type { SourceAdapterCompileMetricOpts } from "@arivie/core/types";
import type { Entity } from "@arivie/semantic";
import { ToolError } from "./errors.js";

const FILTER_COL_PATTERN =
  /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)?$/;

const ENTITY_COL_REF =
  /\b([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_]*)\b/g;

function isFilterPrimitive(
  v: unknown,
): v is string | number | boolean | null {
  return (
    typeof v === "string" ||
    typeof v === "number" ||
    typeof v === "boolean" ||
    v === null
  );
}

function collectEntityRefs(text: string): Set<string> {
  const refs = new Set<string>();
  for (const match of text.matchAll(ENTITY_COL_REF)) {
    refs.add(match[1]!);
  }
  return refs;
}

function detectJoinsNeeded(
  entity: Entity,
  dimensionSqls: string[],
  filterKeys: string[],
): Set<string> {
  const joinTargets = new Set((entity.joins ?? []).map((j) => j.to));
  const refs = new Set<string>();

  for (const sql of dimensionSqls) {
    for (const ref of collectEntityRefs(sql)) {
      if (joinTargets.has(ref) && ref !== entity.name) {
        refs.add(ref);
      }
    }
  }

  for (const key of filterKeys) {
    const dot = key.indexOf(".");
    if (dot > 0) {
      const refEntity = key.slice(0, dot);
      if (joinTargets.has(refEntity) && refEntity !== entity.name) {
        refs.add(refEntity);
      }
    }
  }

  return refs;
}

function buildJoinClauses(
  entity: Entity,
  joinsNeeded: Set<string>,
): string[] {
  const clauses: string[] = [];
  for (const otherEntity of joinsNeeded) {
    const matching = (entity.joins ?? []).filter((j) => j.to === otherEntity);
    if (matching.length === 0) {
      continue;
    }
    if (matching.length > 1) {
      throw new ToolError(
        "join-ambiguous",
        `multiple join paths to '${otherEntity}'; specify entityHint to disambiguate`,
      );
    }
    const join = matching[0]!;
    clauses.push(`LEFT JOIN ${join.to} ON ${join.on}`);
  }
  return clauses;
}

/**
 * Compiles a semantic-layer measure on a Postgres-bound entity to parameterised SQL.
 */
export function compileMetricForPostgres(
  opts: SourceAdapterCompileMetricOpts,
): { query: string; params?: (string | number | boolean | null)[] } {
  const entity = opts.entity as Entity;
  const { metric } = opts;
  const measure = entity.measures?.find((m) => m.name === metric);
  if (measure == null) {
    throw new ToolError(
      "metric-not-found",
      `metric '${metric}' not found on entity '${entity.name}'`,
    );
  }

  const dimensionNames = opts.dimensions ?? [];
  const selectExprs: string[] = [`(${measure.sql}) AS "${measure.name}"`];
  const dimensionSqls: string[] = [];

  for (const dimName of dimensionNames) {
    const dim = entity.dimensions?.find((d) => d.name === dimName);
    if (dim == null) {
      throw new ToolError(
        "dimension-not-found",
        `dimension '${dimName}' not found on entity '${entity.name}'`,
      );
    }
    selectExprs.push(`(${dim.sql}) AS "${dim.name}"`);
    dimensionSqls.push(dim.sql);
  }

  const filterKeys = Object.keys(opts.filters ?? {});
  const joinsNeeded = detectJoinsNeeded(entity, dimensionSqls, filterKeys);
  const joinClauses = buildJoinClauses(entity, joinsNeeded);

  const whereClauses: string[] = [];
  const params: (string | number | boolean | null)[] = [];

  for (const segName of opts.segments ?? []) {
    const seg = entity.segments?.find((s) => s.name === segName);
    if (seg == null) {
      throw new ToolError(
        "segment-not-found",
        `segment '${segName}' not found on entity '${entity.name}'`,
      );
    }
    whereClauses.push(`(${seg.sql})`);
  }

  for (const [col, value] of Object.entries(opts.filters ?? {})) {
    if (!FILTER_COL_PATTERN.test(col)) {
      throw new ToolError(
        "filter-invalid",
        `filter column '${col}' must be a plain identifier`,
      );
    }
    if (!isFilterPrimitive(value)) {
      throw new ToolError(
        "filter-invalid",
        `filter value for '${col}' must be string|number|boolean|null`,
      );
    }
    if (value === null) {
      whereClauses.push(`${col} IS NULL`);
    } else {
      whereClauses.push(`${col} = $${params.length + 1}`);
      params.push(value);
    }
  }

  const fromTable =
    typeof entity.source === "string" ? entity.source : entity.name;
  const parts = [`SELECT ${selectExprs.join(", ")}`, `FROM ${fromTable}`];
  if (joinClauses.length > 0) {
    parts.push(...joinClauses);
  }
  if (whereClauses.length > 0) {
    parts.push(`WHERE ${whereClauses.join(" AND ")}`);
  }
  if (dimensionNames.length > 0) {
    parts.push(
      `GROUP BY ${dimensionNames.map((d) => `"${d}"`).join(", ")}`,
    );
  }

  const query = parts.join(" ");
  return params.length > 0 ? { query, params } : { query };
}
