/* SPDX-License-Identifier: Apache-2.0 */
import type {
  Entity,
  LintError,
  LintOptions,
  LintReport,
  LintWarning,
  SemanticLayer,
} from "./types.js";

const PII_NAME_PATTERN =
  /email|phone|ssn|address|dob|password|secret|token|card/i;

const DEFAULT_PRELOAD_BUDGET = 8000;
const DEFAULT_PRELOAD_HARD_LIMIT = 10000;

const MATERIALISED_STRATEGY_MESSAGE =
  "strategy: materialised is reserved for v0.3+";
const CROSS_SOURCE_MISSING_STRATEGY_MESSAGE =
  'cross-source join missing strategy: declare strategy: "client-side"';

function entityAdapter(entity: Entity): string {
  return entity.source?.adapter ?? "postgres";
}

function isCrossSourceJoin(
  from: Entity,
  toName: string,
  entities: Map<string, Entity>,
): boolean {
  const target = entities.get(toName);
  if (target == null) {
    return false;
  }
  return entityAdapter(from) !== entityAdapter(target);
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function serializeLayer(layer: SemanticLayer): string {
  return JSON.stringify(
    [...layer.entities.values()].sort((a, b) => a.name.localeCompare(b.name)),
  );
}

function suggestMode(
  totalTokens: number,
  opts?: LintOptions,
): "preload" | "browse" | "rag" {
  const hardLimit = opts?.preloadHardLimit ?? DEFAULT_PRELOAD_HARD_LIMIT;
  const budget = opts?.preloadTokenBudget ?? DEFAULT_PRELOAD_BUDGET;
  if (totalTokens > hardLimit) {
    return "rag";
  }
  if (totalTokens > budget) {
    return "browse";
  }
  return "preload";
}

export function lint(layer: SemanticLayer, opts?: LintOptions): LintReport {
  const errors: LintError[] = [];
  const warnings: LintWarning[] = [];
  const entityNames = new Set(layer.entities.keys());

  for (const entity of layer.entities.values()) {
    if (!entity.primary_key.trim()) {
      errors.push({
        severity: "error",
        code: "MISSING_PRIMARY_KEY",
        message: `Entity "${entity.name}" is missing primary_key`,
        entity: entity.name,
      });
    }

    for (const join of entity.joins ?? []) {
      if (!entityNames.has(join.to)) {
        errors.push({
          severity: "error",
          code: "BROKEN_JOIN_TARGET",
          message: `Entity "${entity.name}" join references unknown entity "${join.to}"`,
          entity: entity.name,
        });
        continue;
      }

      if (join.strategy === "materialised") {
        errors.push({
          severity: "error",
          code: "JOIN_STRATEGY_MATERIALISED_RESERVED",
          message: MATERIALISED_STRATEGY_MESSAGE,
          entity: entity.name,
        });
        continue;
      }

      if (
        isCrossSourceJoin(entity, join.to, layer.entities) &&
        join.strategy !== "client-side"
      ) {
        errors.push({
          severity: "error",
          code: "CROSS_SOURCE_JOIN_MISSING_STRATEGY",
          message: CROSS_SOURCE_MISSING_STRATEGY_MESSAGE,
          entity: entity.name,
        });
      }
    }

    for (const column of entity.columns ?? []) {
      if (PII_NAME_PATTERN.test(column.name) && column.pii !== true) {
        warnings.push({
          severity: "warning",
          code: "SUSPECT_PII_COLUMN",
          message: `Column "${column.name}" on entity "${entity.name}" looks like PII but pii is not true`,
          entity: entity.name,
        });
      }
    }
  }

  const serialized = serializeLayer(layer);
  const totalTokens = estimateTokens(serialized);
  const suggestedMode = suggestMode(totalTokens, opts);
  const budget = opts?.preloadTokenBudget ?? DEFAULT_PRELOAD_BUDGET;

  if (totalTokens > budget && suggestedMode !== "preload") {
    warnings.push({
      severity: "warning",
      code: "TOKEN_BUDGET_EXCEEDED",
      message: `Semantic layer is ~${totalTokens} tokens; auto-detected mode would be "${suggestedMode}" not "preload"`,
    });
  }

  return {
    errors,
    warnings,
    stats: {
      totalTokens,
      entityCount: layer.entities.size,
      suggestedMode,
    },
  };
}

function formatLintIssue(
  issue: LintError | LintWarning,
): string {
  const parts: string[] = [`[${issue.code}] ${issue.message}`];
  const meta: string[] = [];
  if (issue.entity != null) {
    meta.push(`entity: ${issue.entity}`);
  }
  if (issue.filePath != null) {
    meta.push(`file: ${issue.filePath}`);
  }
  if (meta.length > 0) {
    parts.push(`(${meta.join(", ")})`);
  }
  return `  ${parts.join("  ")}`;
}

/** Human-readable lint report for CLI / logs. Empty warning/error lists print "none". */
export function formatLintReport(report: LintReport): string {
  const lines: string[] = [
    "Arivie semantic-layer lint",
    "===========================",
    `entities:        ${report.stats.entityCount}`,
    `total tokens:    ${report.stats.totalTokens}`,
    `suggested mode:  ${report.stats.suggestedMode}`,
    "",
  ];

  if (report.warnings.length === 0) {
    lines.push("Warnings: none", "");
  } else {
    lines.push(`Warnings (${report.warnings.length}):`);
    for (const warning of report.warnings) {
      lines.push(formatLintIssue(warning));
    }
    lines.push("");
  }

  if (report.errors.length === 0) {
    lines.push("Errors: none");
  } else {
    lines.push(`Errors (${report.errors.length}):`);
    for (const error of report.errors) {
      lines.push(formatLintIssue(error));
    }
  }

  return lines.join("\n");
}
