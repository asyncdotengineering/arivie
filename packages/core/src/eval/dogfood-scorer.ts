/* SPDX-License-Identifier: Apache-2.0 */
import { createScorer } from "@mastra/core/evals";
import {
  countExecuteCalls,
  extractExecuteSql,
  resultsEqual,
  runValidationRules,
  type ProbeCategory,
  type ValidationRule,
} from "./index.js";

export interface DogfoodScorerOptions {
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

interface ProbeMetadata {
  probeId: string;
  category: ProbeCategory;
  validation: ValidationRule[];
}

function textFromMessages(output: unknown): string {
  if (!Array.isArray(output)) return "";
  const texts: string[] = [];
  for (const msg of output) {
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
          (part as { type?: string }).type === "text" &&
          typeof (part as { text?: string }).text === "string"
        ) {
          texts.push((part as { text: string }).text);
        }
      }
    }
  }
  return texts.join("");
}

export function createDogfoodScorer(opts: DogfoodScorerOptions) {
  const rowLimit = opts.rowLimit ?? 500;

  return createScorer({
    id: "dogfood-composite",
    description:
      "SQL semantic equivalence + probe-specific validation rules",
    type: "agent",
  }).generateScore(async ({ run }) => {
    const metadata = run.requestContext?.get("probe") as
      | ProbeMetadata
      | undefined;
    const output = run.output as unknown;
    const text = textFromMessages(output);
    const toolResults = output;
    const agentSql = extractExecuteSql(toolResults);
    const toolCallCount = countExecuteCalls(toolResults);
    const failures: string[] = [];

    if (agentSql == null) {
      failures.push("agent did not emit execute SQL");
    }

    const groundTruth =
      typeof run.groundTruth === "string" ? run.groundTruth.trim() : "";
    if (!groundTruth) {
      failures.push("missing golden SQL");
    }

    let agentRows: Record<string, unknown>[] = [];
    if (agentSql != null && failures.every((f) => f !== "missing golden SQL")) {
      try {
        agentRows = (await opts.executeSql(agentSql)).slice(0, rowLimit);
      } catch (err) {
        failures.push(
          `agent SQL error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    let goldenRows: Record<string, unknown>[] = [];
    if (groundTruth) {
      try {
        goldenRows = (await opts.executeSql(groundTruth)).slice(0, rowLimit);
      } catch (err) {
        failures.push(
          `golden SQL error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const compareResults =
      metadata?.category === "normal" || metadata?.category === "ambiguous";
    if (
      compareResults &&
      agentSql != null &&
      failures.every((f) => !f.startsWith("agent SQL error"))
    ) {
      if (!resultsEqual(agentRows, goldenRows)) {
        failures.push("resultsEqual: agent SQL result differs from golden SQL");
      }
    }

    failures.push(
      ...runValidationRules(metadata?.validation ?? [], {
        rows: agentRows,
        answerText: text,
        toolCallCount,
      }),
    );

    return failures.length === 0 ? 1 : 0;
  });
}
