/* SPDX-License-Identifier: Apache-2.0 */

export interface ParityFields {
  answer: string;
  sql: string;
  rowCount: number;
  assumptions: string[];
}

export function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

export function parseSseEvents(body: string): string[] {
  return body
    .split("\n\n")
    .map((block) => block.trim())
    .filter((block) => block.startsWith("data: "))
    .map((block) => block.slice("data: ".length));
}

function sqlFromToolInvocation(record: Record<string, unknown>): string | null {
  const invocation = record.toolInvocation;
  if (invocation != null && typeof invocation === "object") {
    const args = (invocation as { args?: unknown }).args;
    if (args != null && typeof args === "object") {
      const sql = (args as { sql?: unknown }).sql;
      if (typeof sql === "string" && sql.trim().length > 0) {
        return sql.trim();
      }
    }
  }
  return null;
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
    return sqlFromToolInvocation(record);
  }
  const args =
    (payload?.args as Record<string, unknown> | undefined) ??
    (record.args as Record<string, unknown> | undefined) ??
    (record.input as Record<string, unknown> | undefined);
  const sql = args?.sql;
  return typeof sql === "string" && sql.trim().length > 0 ? sql.trim() : null;
}

export function extractExecuteSql(toolResults: unknown, steps?: unknown): string | null {
  let lastSql: string | null = null;
  const sources: unknown[] = [];
  if (Array.isArray(toolResults)) {
    sources.push(...toolResults);
  }
  if (Array.isArray(steps)) {
    for (const step of steps) {
      if (step != null && typeof step === "object") {
        const stepResults = (step as { toolResults?: unknown }).toolResults;
        if (Array.isArray(stepResults)) {
          sources.push(...stepResults);
        }
      }
    }
  }
  for (const entry of sources) {
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

function rowCountFromRecord(record: Record<string, unknown>): number | null {
  const payload =
    record.payload != null && typeof record.payload === "object"
      ? (record.payload as Record<string, unknown>)
      : undefined;
  const toolName =
    (typeof record.toolName === "string" && record.toolName) ||
    (typeof payload?.toolName === "string" && payload.toolName) ||
    (typeof record.name === "string" && record.name);
  if (toolName !== "execute") {
    return null;
  }
  const result =
    (record.result as Record<string, unknown> | undefined) ??
    (payload?.result as Record<string, unknown> | undefined);
  if (result != null && typeof result.rowCount === "number") {
    return result.rowCount;
  }
  return null;
}

export function extractRowCount(toolResults: unknown, steps?: unknown): number | null {
  let last: number | null = null;
  const sources: unknown[] = [];
  if (Array.isArray(toolResults)) {
    sources.push(...toolResults);
  }
  if (Array.isArray(steps)) {
    for (const step of steps) {
      if (step != null && typeof step === "object") {
        const stepResults = (step as { toolResults?: unknown }).toolResults;
        if (Array.isArray(stepResults)) {
          sources.push(...stepResults);
        }
      }
    }
  }
  for (const entry of sources) {
    if (entry == null || typeof entry !== "object") {
      continue;
    }
    const count = rowCountFromRecord(entry as Record<string, unknown>);
    if (count != null) {
      last = count;
    }
  }
  return last;
}

function collectNestedToolResults(record: Record<string, unknown>): unknown[] {
  const nested: unknown[] = [];
  const response = record.response;
  if (response != null && typeof response === "object") {
    const messages = (response as { messages?: unknown }).messages;
    if (Array.isArray(messages)) {
      for (const message of messages) {
        if (message == null || typeof message !== "object") {
          continue;
        }
        const toolInvocations = (message as { toolInvocations?: unknown })
          .toolInvocations;
        if (Array.isArray(toolInvocations)) {
          nested.push(...toolInvocations);
        }
        const parts = (message as { parts?: unknown }).parts;
        if (Array.isArray(parts)) {
          nested.push(...parts);
        }
        const content = (message as { content?: unknown }).content;
        if (content != null && typeof content === "object") {
          const contentParts = (content as { parts?: unknown }).parts;
          if (Array.isArray(contentParts)) {
            nested.push(...contentParts);
          }
        }
      }
    }
  }
  return nested;
}

/** Order-independent assumption tags derived from agent answer text. */
export function extractAssumptions(answer: string): string[] {
  const lower = answer.toLowerCase();
  const tags: string[] = [];
  if (lower.includes("completed")) {
    tags.push("completed-only");
  }
  return tags;
}

function mergeToolResults(result: Record<string, unknown>): unknown[] {
  const toolResults = result.toolResults;
  const steps = result.steps;
  const stepToolResults = Array.isArray(steps)
    ? steps.flatMap((step) =>
        step != null && typeof step === "object"
          ? ((step as { toolResults?: unknown }).toolResults ?? [])
          : [],
      )
    : [];
  return [
    ...(Array.isArray(toolResults) ? toolResults : []),
    ...(Array.isArray(stepToolResults) ? stepToolResults : []),
    ...collectNestedToolResults(result),
  ];
}

export function parityFromAgentGenerate(result: unknown): ParityFields {
  const record =
    result != null && typeof result === "object"
      ? (result as Record<string, unknown>)
      : {};
  const answer =
    typeof record.text === "string"
      ? record.text
      : typeof record.answer === "string"
        ? record.answer
        : "";
  const merged = mergeToolResults(record);
  const sql =
    (typeof record.sql === "string" ? record.sql : null) ??
    extractExecuteSql(merged, record.steps) ??
    "";
  const rowCount =
    (typeof record.rowCount === "number" ? record.rowCount : null) ??
    extractRowCount(merged, record.steps) ??
    0;
  return {
    answer,
    sql,
    rowCount,
    assumptions: extractAssumptions(answer),
  };
}

export function parityFromHttpSse(body: string): ParityFields {
  const events = parseSseEvents(body);
  const finalJson = events.find((event) => event.startsWith("{"));
  if (finalJson == null) {
    throw new Error("HTTP SSE stream missing final JSON payload");
  }
  const parsed = JSON.parse(finalJson) as Record<string, unknown>;
  return parityFromAgentGenerate(parsed);
}

function tryParseEmbeddedJson(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed != null && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // not JSON — use as plain answer text
  }
  return null;
}

export function parityFromMcpAsk(result: unknown): ParityFields {
  if (result == null || typeof result !== "object") {
    throw new Error("MCP ask returned unexpected shape");
  }
  const record = result as Record<string, unknown>;
  const content = record.content;
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part != null && typeof part === "object") {
        const text = (part as { text?: unknown }).text;
        if (typeof text === "string") {
          const embedded = tryParseEmbeddedJson(text);
          if (embedded != null) {
            return parityFromAgentGenerate(embedded);
          }
        }
      }
    }
  }
  if (typeof record.text === "string") {
    const embedded = tryParseEmbeddedJson(record.text);
    if (embedded != null) {
      return parityFromAgentGenerate(embedded);
    }
  }
  if (typeof record.content === "string") {
    const embedded = tryParseEmbeddedJson(record.content);
    if (embedded != null) {
      return parityFromAgentGenerate(embedded);
    }
  }
  if ("text" in record || "toolResults" in record) {
    return parityFromAgentGenerate(record);
  }
  return parityFromAgentGenerate(record);
}

export function assumptionsEqual(left: string[], right: string[]): boolean {
  const a = new Set(left);
  const b = new Set(right);
  if (a.size !== b.size) {
    return false;
  }
  for (const tag of a) {
    if (!b.has(tag)) {
      return false;
    }
  }
  return true;
}
