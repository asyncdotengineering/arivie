/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Deterministic probes for S3-03 MCP↔HTTP parity (REQ-27).
 * Same fixture SQL as eval-mock-model, plus doStream for HTTP SSE handler path.
 */
import type {
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import type { LanguageModel } from "ai";

export const PARITY_PROBES = [
  {
    id: "parity-revenue",
    category: "ambiguous" as const,
    question: "what is total revenue?",
    golden_sql: `
      SELECT COALESCE(SUM(total_amount), 0) AS revenue
      FROM orders
      WHERE status = 'completed'
    `,
  },
  {
    id: "parity-orders",
    category: "normal" as const,
    question: "how many orders?",
    golden_sql: `
      SELECT COUNT(*)::bigint AS order_count
      FROM orders
    `,
  },
] as const;

type ParityProbe = (typeof PARITY_PROBES)[number];

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

function lastUserText(options: LanguageModelV3CallOptions): string {
  const prompt = options.prompt;
  if (prompt == null) {
    return "";
  }
  if (typeof prompt === "string") {
    return prompt;
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

function findProbe(userText: string): ParityProbe | undefined {
  if (userText === "warmup") {
    return undefined;
  }
  return PARITY_PROBES.find((probe) => probe.question === userText);
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

function answerForProbe(probe: ParityProbe): string {
  if (probe.category === "ambiguous") {
    return [
      "Assumptions: counting **completed** orders only, **all time** (no date filter).",
      "SQL and result are shown from the execute tool.",
    ].join(" ");
  }
  return `Result for: ${probe.question}`;
}

async function parityGenerate(options: LanguageModelV3CallOptions) {
  const userText = lastUserText(options);
  if (userText === "warmup") {
    return generateResult([{ type: "text", text: "warmup ok" }]);
  }

  const probe = findProbe(userText);
  if (probe == null) {
    return generateResult([
      {
        type: "text",
        text: `No fixture for question: ${userText}`,
      },
    ]);
  }

  return generateResult([
    toolCall(probe.golden_sql, `exec-${probe.id}`),
    { type: "text", text: answerForProbe(probe) },
  ]);
}

function streamChunksFromGenerate(
  content: Array<{ type: string; text?: string; toolCallId?: string; toolName?: string; input?: string }>,
): LanguageModelV3StreamPart[] {
  const chunks: LanguageModelV3StreamPart[] = [];
  for (const part of content) {
    if (part.type === "text" && typeof part.text === "string") {
      const id = `text-${chunks.length}`;
      chunks.push({ type: "text-start", id });
      chunks.push({ type: "text-delta", id, delta: part.text });
      chunks.push({ type: "text-end", id });
    }
    if (part.type === "tool-call") {
      chunks.push({
        type: "tool-call",
        toolCallId: part.toolCallId ?? "call-1",
        toolName: part.toolName ?? "execute",
        input: part.input ?? "{}",
      });
    }
  }
  chunks.push({
    type: "finish",
    finishReason: { unified: "stop", raw: undefined },
    logprobs: undefined,
    usage: STREAM_FINISH_USAGE,
  });
  return chunks;
}

export function createParityMockModel(): LanguageModel {
  const model = new MockLanguageModelV3({
    provider: "eval-mock",
    modelId: "parity-mock-v1",
    doGenerate: parityGenerate,
    doStream: async (options) => {
      const generated = await parityGenerate(options);
      return {
        stream: simulateReadableStream({
          chunks: streamChunksFromGenerate(generated.content),
        }),
      };
    },
  });

  return model as unknown as LanguageModel;
}
