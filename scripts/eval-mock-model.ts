/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Deterministic mock LLM for S1 eval when no provider API key is set.
 * Drives execute tool calls from golden SQL so the runner, tools, and
 * resultsEqual path are exercised end-to-end (not a substitute for live LLM eval).
 */
import type { LanguageModelV3CallOptions } from "@ai-sdk/provider";
import { MockLanguageModelV3 } from "ai/test";
import type { LanguageModel } from "ai";

interface ProbeLike {
  id: string;
  category: string;
  question: string;
  golden_sql: string;
}

const USAGE = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
};

function lastUserText(options: LanguageModelV3CallOptions): string {
  const prompt = options.prompt;
  if (prompt == null) {
    return "";
  }
  for (let i = prompt.length - 1; i >= 0; i -= 1) {
    const message = prompt[i];
    if (message?.role === "user") {
      if (typeof message.content === "string") {
        return message.content;
      }
      if (Array.isArray(message.content)) {
        return message.content
          .filter((part) => part.type === "text")
          .map((part) => ("text" in part ? part.text : ""))
          .join("\n");
      }
    }
  }
  return "";
}

function findProbe(probes: ProbeLike[], userText: string): ProbeLike | undefined {
  if (userText === "warmup") {
    return undefined;
  }
  return probes.find((probe) => probe.question === userText);
}

function toolCall(sql: string, id: string) {
  return {
    type: "tool-call" as const,
    toolCallId: id,
    toolName: "execute",
    input: JSON.stringify({ sql: sql.trim() }),
  };
}

function generateResult(
  content: Array<
    | ReturnType<typeof toolCall>
    | { type: "text"; text: string }
  >,
  finishReason: "stop" | "tool-calls" = "stop",
) {
  return {
    content,
    finishReason,
    usage: USAGE,
    warnings: [],
  };
}

function answerForProbe(probe: ProbeLike): string {
  if (probe.category === "ambiguous") {
    return [
      "Assumptions: counting **completed** orders only, **all time** (no date filter).",
      "SQL and result are shown from the execute tool.",
    ].join(" ");
  }
  if (probe.category === "zero-row") {
    return [
      "I investigated: there is no `shipped` status in the orders semantic layer.",
      "The first query returned zero rows; I broadened the check before concluding.",
      "Do not treat this as zero overall revenue.",
    ].join(" ");
  }
  return `Result for: ${probe.question}`;
}

export function createEvalMockModel(probes: ProbeLike[]): LanguageModel {
  const zeroRowStep = new Map<string, number>();

  const model = new MockLanguageModelV3({
    provider: "eval-mock",
    modelId: "eval-mock-v1",
    doGenerate: async (options) => {
      const userText = lastUserText(options);
      if (userText === "warmup") {
        return generateResult([{ type: "text", text: "warmup ok" }]);
      }

      const probe = findProbe(probes, userText);
      if (probe == null) {
        return generateResult([
          {
            type: "text",
            text: `No fixture for question: ${userText}`,
          },
        ]);
      }

      if (probe.category === "zero-row") {
        const step = zeroRowStep.get(probe.id) ?? 0;
        zeroRowStep.set(probe.id, step + 1);
        if (step === 0) {
          return generateResult(
            [toolCall(probe.golden_sql, `exec-${probe.id}-1`)],
            "tool-calls",
          );
        }
        return generateResult([
          toolCall(
            `SELECT status, COUNT(*)::bigint AS order_count FROM orders GROUP BY status ORDER BY status`,
            `exec-${probe.id}-2`,
          ),
          { type: "text", text: answerForProbe(probe) },
        ]);
      }

      return generateResult([
        toolCall(probe.golden_sql, `exec-${probe.id}`),
        { type: "text", text: answerForProbe(probe) },
      ]);
    },
  });

  return model as unknown as LanguageModel;
}
