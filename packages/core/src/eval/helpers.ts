/* SPDX-License-Identifier: Apache-2.0 */

export type ProbeCategory = "normal" | "ambiguous" | "zero-row";

export type ValidationRule =
  | { result_has_rows: boolean }
  | { column_exists: string }
  | { value_positive: string }
  | { max_rows: number }
  | { assumption_states: string[] }
  | { tool_calls_min: number }
  | { answer_must_not_claim_zero_revenue: boolean };

function toolNameFromRecord(record: Record<string, unknown>): string | undefined {
  const payload =
    record.payload != null && typeof record.payload === "object"
      ? (record.payload as Record<string, unknown>)
      : undefined;
  if (typeof record.toolName === "string" && record.toolName) {
    return record.toolName;
  }
  if (typeof payload?.toolName === "string" && payload.toolName) {
    return payload.toolName;
  }
  if (typeof record.name === "string" && record.name) {
    return record.name;
  }
  if (typeof record.tool === "string" && record.tool) {
    return record.tool;
  }
  return undefined;
}

function toolNameFromToolInvocationPart(part: Record<string, unknown>): string | undefined {
  const toolInvocation =
    part.toolInvocation != null && typeof part.toolInvocation === "object"
      ? (part.toolInvocation as Record<string, unknown>)
      : undefined;
  if (toolInvocation == null) return undefined;
  return typeof toolInvocation.toolName === "string"
    ? toolInvocation.toolName
    : undefined;
}

export function countExecuteCalls(
  toolResults: unknown,
  steps?: unknown,
): number {
  let count = 0;

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
            (part as { type?: string }).type === "tool-invocation" &&
            toolNameFromToolInvocationPart(part as Record<string, unknown>) === "execute"
          ) {
            count += 1;
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
    if (toolNameFromRecord(entry as Record<string, unknown>) === "execute") {
      count += 1;
    }
  }

  return count;
}

export function answerClaimsZeroRevenue(text: string): boolean {
  const lower = text.toLowerCase();
  const zeroPhrases = [
    "revenue is 0",
    "revenue was 0",
    "revenue is $0",
    "no revenue",
    "zero revenue",
    "revenue of 0",
  ];
  const investigates =
    lower.includes("investigate") ||
    lower.includes("no rows") ||
    lower.includes("empty") ||
    lower.includes("shipped") ||
    lower.includes("status");
  if (investigates) {
    return false;
  }
  return zeroPhrases.some((phrase) => lower.includes(phrase));
}

export interface ValidationContext {
  rows: Record<string, unknown>[];
  answerText: string;
  toolCallCount: number;
}

export function runValidationRules(
  rules: ValidationRule[],
  ctx: ValidationContext,
): string[] {
  const failures: string[] = [];
  for (const rule of rules) {
    if ("result_has_rows" in rule) {
      const want = rule.result_has_rows;
      const has = ctx.rows.length > 0;
      if (want !== has) {
        failures.push(`result_has_rows: expected ${want}, got ${has}`);
      }
    }
    if ("column_exists" in rule) {
      const col = rule.column_exists;
      const found = ctx.rows.some((row) =>
        Object.prototype.hasOwnProperty.call(row, col),
      );
      if (!found) {
        failures.push(`column_exists: missing column ${col}`);
      }
    }
    if ("value_positive" in rule) {
      const col = rule.value_positive;
      const values = ctx.rows.map((row) => row[col]);
      const ok = values.some((v) => {
        const n = Number(v);
        return Number.isFinite(n) && n > 0;
      });
      if (!ok) {
        failures.push(`value_positive: ${col} is not positive`);
      }
    }
    if ("max_rows" in rule) {
      if (ctx.rows.length > rule.max_rows) {
        failures.push(`max_rows: ${ctx.rows.length} > ${rule.max_rows}`);
      }
    }
    if ("assumption_states" in rule) {
      const lower = ctx.answerText.toLowerCase();
      for (const phrase of rule.assumption_states) {
        if (!lower.includes(phrase.toLowerCase())) {
          failures.push(`assumption_states: missing "${phrase}" in answer`);
        }
      }
    }
    if ("tool_calls_min" in rule) {
      if (ctx.toolCallCount < rule.tool_calls_min) {
        failures.push(
          `tool_calls_min: ${ctx.toolCallCount} < ${rule.tool_calls_min}`,
        );
      }
    }
    if ("answer_must_not_claim_zero_revenue" in rule) {
      if (answerClaimsZeroRevenue(ctx.answerText)) {
        failures.push(
          "answer_must_not_claim_zero_revenue: answer claims zero revenue without investigation",
        );
      }
    }
  }
  return failures;
}
