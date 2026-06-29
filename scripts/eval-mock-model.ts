/* SPDX-License-Identifier: Apache-2.0 */
import type {
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import type { LanguageModel } from "ai";
import { estimateTokens } from "@arivie/semantic";

interface ProbeLike {
  id: string;
  category: string;
  question: string;
  golden_sql: string;
}

export interface EvalPromptMeasurement {
  probeId: string;
  inputTokens: number;
}

export interface EvalMockModelOptions {
  toolName?: string;
  onPrompt?: (measurement: EvalPromptMeasurement) => void;
}

const USAGE = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
};

const STREAM_FINISH_USAGE = {
  inputTokens: {
    total: 0,
    noCache: 0,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: {
    total: 0,
    text: 0,
    reasoning: undefined,
  },
};

function textContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .filter(
      (part): part is { type: "text"; text: string } =>
        part != null &&
        typeof part === "object" &&
        (part as { type?: unknown }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string",
    )
    .map((part) => part.text)
    .join("\n");
}

function lastUserText(options: LanguageModelV3CallOptions): string {
  const prompt = options.prompt;
  if (!Array.isArray(prompt)) {
    return typeof prompt === "string" ? prompt : "";
  }
  for (let i = prompt.length - 1; i >= 0; i -= 1) {
    const message = prompt[i];
    if (message?.role === "user") {
      return textContent(message.content);
    }
  }
  return "";
}

function promptInputText(options: LanguageModelV3CallOptions): string {
  const prompt = options.prompt;
  if (!Array.isArray(prompt)) {
    return typeof prompt === "string" ? prompt : "";
  }
  return prompt
    .filter((message) => message.role === "system" || message.role === "user")
    .map((message) => textContent(message.content))
    .filter((text) => text.length > 0)
    .join("\n\n");
}

function findProbe(
  probes: ProbeLike[],
  userText: string,
): ProbeLike | undefined {
  return probes.find(
    (probe) =>
      userText === probe.question || userText.endsWith(`\n\n${probe.question}`),
  );
}

function toolCall(sql: string, id: string, toolName: string) {
  return {
    type: "tool-call" as const,
    toolCallId: id,
    toolName,
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

function streamChunksFromGenerate(
  content: Array<
    | ReturnType<typeof toolCall>
    | { type: "text"; text: string }
  >,
  finishReason: "stop" | "tool-calls",
): LanguageModelV3StreamPart[] {
  const chunks: LanguageModelV3StreamPart[] = [];
  for (const part of content) {
    if (part.type === "text") {
      const id = `text-${chunks.length}`;
      chunks.push({ type: "text-start", id });
      chunks.push({ type: "text-delta", id, delta: part.text });
      chunks.push({ type: "text-end", id });
    } else {
      chunks.push(part);
    }
  }
  chunks.push({
    type: "finish",
    finishReason: { unified: finishReason, raw: undefined },
    logprobs: undefined,
    usage: STREAM_FINISH_USAGE,
  });
  return chunks;
}

export function createEvalMockModel(
  probes: ProbeLike[],
  options: EvalMockModelOptions = {},
): LanguageModel {
  const zeroRowStep = new Map<string, number>();
  const measured = new Set<string>();
  const toolName = options.toolName ?? "execute";

  async function generate(call: LanguageModelV3CallOptions) {
    const userText = lastUserText(call);
    const probe = findProbe(probes, userText);
    if (probe == null) {
      return generateResult([
        {
          type: "text",
          text: `No fixture for question: ${userText}`,
        },
      ]);
    }

    if (!measured.has(probe.id)) {
      measured.add(probe.id);
      options.onPrompt?.({
        probeId: probe.id,
        inputTokens: estimateTokens(promptInputText(call)),
      });
    }

    if (probe.category === "zero-row") {
      const step = zeroRowStep.get(probe.id) ?? 0;
      zeroRowStep.set(probe.id, step + 1);
      if (step === 0) {
        return generateResult(
          [toolCall(probe.golden_sql, `exec-${probe.id}-1`, toolName)],
          "tool-calls",
        );
      }
      return generateResult([
        toolCall(
          `SELECT status, COUNT(*)::bigint AS order_count FROM orders GROUP BY status ORDER BY status`,
          `exec-${probe.id}-2`,
          toolName,
        ),
        { type: "text", text: answerForProbe(probe) },
      ]);
    }

    return generateResult([
      toolCall(probe.golden_sql, `exec-${probe.id}`, toolName),
      { type: "text", text: answerForProbe(probe) },
    ]);
  }

  const model = new MockLanguageModelV3({
    provider: "eval-mock",
    modelId: "eval-mock-v1",
    doGenerate: generate,
    doStream: async (call) => {
      const generated = await generate(call);
      return {
        stream: simulateReadableStream({
          chunks: streamChunksFromGenerate(
            generated.content,
            generated.finishReason,
          ),
        }),
      };
    },
  });

  return model as unknown as LanguageModel;
}
