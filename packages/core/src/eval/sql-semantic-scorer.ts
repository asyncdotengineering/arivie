/* SPDX-License-Identifier: Apache-2.0 */
import { createScorer } from "@mastra/core/evals";

export interface SqlSemanticScorerOptions {
  /**
   * Execute a read-only SQL query and return its rows. The same function is
   * used for both the golden SQL and the agent SQL so comparison is fair.
   */
  executeSql: (sql: string) => Promise<Record<string, unknown>[]>;
  /**
   * Maximum rows to compare (default 500). Result sets larger than this are
   * truncated before comparison to keep evals fast.
   */
  rowLimit?: number;
}

function normalizeCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return String(Number(value));
  }
  return String(value);
}

function rowFingerprint(row: Record<string, unknown>): string {
  return Object.keys(row)
    .sort()
    .map((key) => `${key}=${normalizeCell(row[key])}`)
    .join("|");
}

/**
 * Set equality on result rows, ignoring row order. Column names and values
 * are normalized; two rows are equal when every column has the same string
 * representation.
 */
export function resultsEqual(
  left: Record<string, unknown>[],
  right: Record<string, unknown>[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const leftSet = new Set(left.map(rowFingerprint));
  const rightSet = new Set(right.map(rowFingerprint));
  if (leftSet.size !== rightSet.size) {
    return false;
  }
  for (const fp of leftSet) {
    if (!rightSet.has(fp)) {
      return false;
    }
  }
  return true;
}

function sqlFromToolPayload(record: Record<string, unknown>): string | null {
  const payload =
    record.payload != null && typeof record.payload === "object"
      ? (record.payload as Record<string, unknown>)
      : undefined;
  const toolName =
    (typeof record.toolName === "string" && record.toolName) ||
    (typeof payload?.toolName === "string" && payload.toolName) ||
    (typeof record.name === "string" && record.name) ||
    (typeof record.tool === "string" && record.tool) ||
    (typeof record.toolId === "string" && record.toolId);
  if (toolName !== "execute") {
    return null;
  }
  const args =
    (payload?.args as Record<string, unknown> | undefined) ??
    (record.args as Record<string, unknown> | undefined) ??
    (record.input as Record<string, unknown> | undefined);
  const sql = args?.sql;
  return typeof sql === "string" && sql.trim().length > 0 ? sql.trim() : null;
}

function sqlFromToolInvocationPart(part: Record<string, unknown>): string | null {
  const toolInvocation =
    part.toolInvocation != null && typeof part.toolInvocation === "object"
      ? (part.toolInvocation as Record<string, unknown>)
      : undefined;
  if (toolInvocation == null) {
    return null;
  }
  const toolName =
    typeof toolInvocation.toolName === "string" ? toolInvocation.toolName : "";
  if (toolName !== "execute") {
    return null;
  }
  const args =
    toolInvocation.args != null && typeof toolInvocation.args === "object"
      ? (toolInvocation.args as Record<string, unknown>)
      : undefined;
  const sql = args?.sql;
  return typeof sql === "string" && sql.trim().length > 0 ? sql.trim() : null;
}

/**
 * Pull the last `execute` SQL out of an agent's tool results. Accepts:
 * - the raw agent result object (`toolResults` + optional `steps`)
 * - an array of MastraDBMessage (e.g. from `runEvals` agent scoring)
 * - a direct array of tool-result records
 */
export function extractExecuteSql(
  toolResults: unknown,
  steps?: unknown,
): string | null {
  let lastSql: string | null = null;

  // MastraDBMessage[] path (runEvals agent scorer)
  if (Array.isArray(toolResults)) {
    const maybeMessages = toolResults as unknown[];
    for (const msg of maybeMessages) {
      if (msg == null || typeof msg !== "object") continue;
      const content = (msg as { content?: unknown }).content;
      if (
        content != null &&
        typeof content === "object" &&
        "parts" in content
      ) {
        const parts = (content as { parts?: unknown[] }).parts ?? [];
        for (const part of parts) {
          if (
            part != null &&
            typeof part === "object" &&
            (part as { type?: string }).type === "tool-invocation"
          ) {
            const sql = sqlFromToolInvocationPart(part as Record<string, unknown>);
            if (sql != null) {
              lastSql = sql;
            }
          }
        }
      }
    }
  }

  // Agent result object path
  const candidates: unknown[] = [];
  if (Array.isArray(toolResults)) {
    candidates.push(...toolResults);
  }
  if (Array.isArray(steps)) {
    for (const step of steps) {
      if (step != null && typeof step === "object") {
        const stepResults = (step as { toolResults?: unknown }).toolResults;
        if (Array.isArray(stepResults)) {
          candidates.push(...stepResults);
        }
      }
    }
  }
  for (const entry of candidates) {
    if (entry == null || typeof entry !== "object") {
      continue;
    }
    const sql = sqlFromToolPayload(entry as Record<string, unknown>);
    if (sql != null) {
      lastSql = sql;
    }
  }
  return lastSql;
}

/**
 * Create a Mastra scorer that judges SQL semantic equivalence by executing
 * the golden SQL and the agent's extracted SQL and comparing result sets.
 *
 * The scorer expects:
 *   - `run.input` — the probe question (used only for logging/context)
 *   - `run.output` — the agent output object with `.text` and `.toolResults`
 *   - `run.groundTruth` — the golden SQL string
 *
 * Returns 1 when result sets are equivalent, 0 otherwise.
 */
export function createSqlSemanticScorer(opts: SqlSemanticScorerOptions) {
  const rowLimit = opts.rowLimit ?? 500;

  return createScorer({
    id: "sql-semantic-equivalence",
    description:
      "Executes golden SQL and agent SQL and compares result sets for semantic equivalence",
    type: "agent",
  }).generateScore(async ({ run }) => {
    const groundTruth =
      typeof run.groundTruth === "string" ? run.groundTruth.trim() : "";
    if (!groundTruth) {
      return 0;
    }

    const output = run.output as unknown as Record<string, unknown> | undefined;
    const agentSql = extractExecuteSql(
      output?.toolResults,
      output?.steps,
    );
    if (agentSql == null) {
      return 0;
    }

    const [goldenRows, agentRows] = await Promise.all([
      opts.executeSql(groundTruth).then((rows) => rows.slice(0, rowLimit)),
      opts.executeSql(agentSql).then((rows) => rows.slice(0, rowLimit)),
    ]);

    return resultsEqual(goldenRows, agentRows) ? 1 : 0;
  });
}
