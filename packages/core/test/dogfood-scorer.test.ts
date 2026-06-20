/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { RequestContext } from "@mastra/core/di";
import { createDogfoodScorer } from "../src/eval/dogfood-scorer.js";

function makeToolInvocationMessage(sql: string) {
  return {
    id: "msg-1",
    role: "assistant" as const,
    createdAt: new Date(),
    content: {
      format: 2 as const,
      parts: [
        {
          type: "tool-invocation" as const,
          toolInvocation: {
            toolCallId: "tc-1",
            toolName: "execute",
            args: { sql },
            state: "result" as const,
            result: { rows: [], rowCount: 0 },
          },
        },
      ],
    },
  };
}

function makeTextMessage(text: string) {
  return {
    id: "msg-2",
    role: "assistant" as const,
    createdAt: new Date(),
    content: {
      format: 2 as const,
      parts: [{ type: "text" as const, text }],
    },
  };
}

function probeMetadata(
  category: "normal" | "ambiguous" | "zero-row" = "normal",
  validation: Record<string, unknown>[] = [],
) {
  const ctx = new RequestContext();
  ctx.set("probe", {
    probeId: "p1",
    category,
    validation,
  });
  return ctx;
}

describe("createDogfoodScorer", () => {
  it("passes when SQL result matches golden and validation rules pass", async () => {
    const scorer = createDogfoodScorer({
      executeSql: async () => [{ revenue: 100 }],
    });
    const result = await scorer.run({
      input: "What is total revenue?",
      output: [makeToolInvocationMessage("SELECT SUM(total) AS revenue FROM orders")],
      groundTruth: "SELECT SUM(total) AS revenue FROM orders",
      requestContext: probeMetadata("normal", [{ result_has_rows: true }]),
    });
    expect(result.score).toBe(1);
  });

  it("fails when SQL result differs from golden", async () => {
    let calls = 0;
    const scorer = createDogfoodScorer({
      executeSql: async () => {
        calls += 1;
        return calls === 1 ? [{ revenue: 100 }] : [{ revenue: 200 }];
      },
    });
    const result = await scorer.run({
      input: "What is total revenue?",
      output: [makeToolInvocationMessage("SELECT SUM(total) AS revenue FROM orders")],
      groundTruth: "SELECT SUM(total) AS revenue FROM orders",
      requestContext: probeMetadata("normal"),
    });
    expect(result.score).toBe(0);
  });

  it("skips SQL comparison for zero-row category", async () => {
    const scorer = createDogfoodScorer({
      executeSql: async () => [],
    });
    const result = await scorer.run({
      input: "Revenue last month?",
      output: [
        makeToolInvocationMessage("SELECT SUM(total) FROM orders WHERE created_at > NOW() - INTERVAL '1 month'"),
        makeTextMessage("The revenue is $0."),
      ],
      groundTruth: "SELECT SUM(total) FROM orders WHERE created_at > NOW() - INTERVAL '1 month'",
      requestContext: probeMetadata("zero-row", [
        { answer_must_not_claim_zero_revenue: true },
      ]),
    });
    expect(result.score).toBe(0);
  });

  it("fails when validation rule fails", async () => {
    const scorer = createDogfoodScorer({
      executeSql: async () => [],
    });
    const result = await scorer.run({
      input: "What is total revenue?",
      output: [makeToolInvocationMessage("SELECT SUM(total) AS revenue FROM orders")],
      groundTruth: "SELECT SUM(total) AS revenue FROM orders",
      requestContext: probeMetadata("normal", [{ result_has_rows: true }]),
    });
    expect(result.score).toBe(0);
  });

  it("fails when agent emits no execute SQL", async () => {
    const scorer = createDogfoodScorer({
      executeSql: async () => [],
    });
    const result = await scorer.run({
      input: "What is total revenue?",
      output: [makeTextMessage("I don't know.")],
      groundTruth: "SELECT SUM(total) AS revenue FROM orders",
      requestContext: probeMetadata("normal"),
    });
    expect(result.score).toBe(0);
  });
});
