/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import {
  createSqlSemanticScorer,
  extractExecuteSql,
  resultsEqual,
} from "../src/eval/sql-semantic-scorer.js";

describe("resultsEqual", () => {
  it("returns true for identical rows in different orders", () => {
    const a = [{ id: 1, name: "x" }, { id: 2, name: "y" }];
    const b = [{ id: 2, name: "y" }, { id: 1, name: "x" }];
    expect(resultsEqual(a, b)).toBe(true);
  });

  it("returns false when counts differ", () => {
    const a = [{ id: 1 }];
    const b = [{ id: 1 }, { id: 2 }];
    expect(resultsEqual(a, b)).toBe(false);
  });

  it("returns false when values differ", () => {
    const a = [{ id: 1 }];
    const b = [{ id: 2 }];
    expect(resultsEqual(a, b)).toBe(false);
  });

  it("normalizes numbers and bigints", () => {
    const a = [{ n: 1 }];
    const b = [{ n: BigInt(1) }];
    expect(resultsEqual(a, b)).toBe(true);
  });

  it("normalizes null and undefined", () => {
    const a = [{ n: null }];
    const b = [{ n: undefined }];
    expect(resultsEqual(a, b)).toBe(true);
  });
});

describe("extractExecuteSql", () => {
  it("extracts SQL from toolResults payload", () => {
    const sql = extractExecuteSql([
      {
        toolName: "execute",
        args: { sql: "SELECT 1" },
      },
    ]);
    expect(sql).toBe("SELECT 1");
  });

  it("returns the last execute SQL", () => {
    const sql = extractExecuteSql([
      { toolName: "execute", args: { sql: "SELECT 1" } },
      { toolName: "execute", args: { sql: "SELECT 2" } },
    ]);
    expect(sql).toBe("SELECT 2");
  });

  it("ignores non-execute tools", () => {
    const sql = extractExecuteSql([
      { toolName: "compile_metric", args: { metric: "revenue" } },
      { toolName: "execute", args: { sql: "SELECT 3" } },
    ]);
    expect(sql).toBe("SELECT 3");
  });

  it("returns null when no execute SQL is present", () => {
    const sql = extractExecuteSql([
      { toolName: "compile_metric", args: { metric: "revenue" } },
    ]);
    expect(sql).toBeNull();
  });

  it("reads from steps[].toolResults", () => {
    const sql = extractExecuteSql([], [
      { toolResults: [{ toolName: "execute", args: { sql: "SELECT 4" } }] },
    ]);
    expect(sql).toBe("SELECT 4");
  });
});

describe("createSqlSemanticScorer", () => {
  it("scores 1 when result sets match", async () => {
    const scorer = createSqlSemanticScorer({
      executeSql: async () => [{ n: 1 }],
    });
    const result = await scorer.run({
      input: "What is one?",
      output: {
        text: "Here is one",
        toolResults: [{ toolName: "execute", args: { sql: "SELECT 1 AS n" } }],
      },
      groundTruth: "SELECT 1 AS n",
      runId: "run-1",
    });
    expect(result.score).toBe(1);
  });

  it("scores 0 when result sets differ", async () => {
    let callCount = 0;
    const scorer = createSqlSemanticScorer({
      executeSql: async () => {
        callCount += 1;
        return callCount === 1 ? [{ n: 1 }] : [{ n: 2 }];
      },
    });
    const result = await scorer.run({
      input: "What is one?",
      output: {
        text: "Here is two",
        toolResults: [{ toolName: "execute", args: { sql: "SELECT 2 AS n" } }],
      },
      groundTruth: "SELECT 1 AS n",
      runId: "run-2",
    });
    expect(result.score).toBe(0);
  });

  it("scores 0 when no execute SQL is emitted", async () => {
    const scorer = createSqlSemanticScorer({
      executeSql: async () => [],
    });
    const result = await scorer.run({
      input: "What is one?",
      output: { text: "No SQL" },
      groundTruth: "SELECT 1",
      runId: "run-3",
    });
    expect(result.score).toBe(0);
  });

  it("respects rowLimit", async () => {
    const scorer = createSqlSemanticScorer({
      executeSql: async () => [
        { n: 1 },
        { n: 2 },
        { n: 3 },
      ],
      rowLimit: 2,
    });
    const result = await scorer.run({
      input: "List numbers",
      output: {
        text: "Numbers",
        toolResults: [
          { toolName: "execute", args: { sql: "SELECT * FROM nums" } },
        ],
      },
      groundTruth: "SELECT * FROM nums",
      runId: "run-4",
    });
    expect(result.score).toBe(1);
  });
});
