/* SPDX-License-Identifier: Apache-2.0 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SemanticLayer } from "@arivie/semantic";
import type { PostgresAdapter } from "@arivie/db-postgres";
import {
  InProcessSandboxFilesystem,
  makeWorkspace,
} from "@arivie/workspace";
import { Workspace } from "@mastra/core/workspace";
import {
  convertArrayToReadableStream,
  MockLanguageModelV3,
} from "ai/test";
import { describe, expect, it } from "vitest";
import { Agent } from "@mastra/core/agent";
import { executeToolFor } from "../src/tools/execute.js";
import {
  finalizeReportStopWhen,
  finalizeReportTool,
  shouldRegisterFinalizeReport,
} from "../src/tools/finalize-report.js";

function emptySemantic(): SemanticLayer {
  return {
    entities: new Map(),
    catalog: {
      entities: [],
      generated_at: "2026-01-01T00:00:00.000Z",
      source_files: [],
    },
  };
}

function mockDb(): PostgresAdapter {
  return {
    kind: "postgres",
    id: "postgres:test",
    url: "postgres://test",
    sql: {} as PostgresAdapter["sql"],
    execute: async () => ({
      rows: [],
      rowCount: 0,
      truncated: false,
      durationMs: 0,
    }),
    introspect: async () => [],
    verifyOwnerIdentity: async () => {},
    setupRole: async () => {},
  };
}

const FINALIZE_INPUT = {
  sql: "SELECT 1",
  csvResults: "1\n1",
  narrative: "Revenue is up.",
};

const STREAM_USAGE = {
  inputTokens: {
    total: 1,
    noCache: 1,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: {
    total: 1,
    text: 1,
    reasoning: undefined,
  },
};

function finalizeReportToolCallStream() {
  return convertArrayToReadableStream([
    { type: "stream-start", warnings: [] },
    {
      type: "response-metadata",
      id: "id-0",
      modelId: "mock-model-id",
      timestamp: new Date(0),
    },
    {
      type: "tool-call",
      toolCallId: "call-finalize-1",
      toolName: "finalize_report",
      input: JSON.stringify(FINALIZE_INPUT),
      providerExecuted: false,
    },
    {
      type: "finish",
      finishReason: "tool-calls",
      usage: STREAM_USAGE,
    },
  ]);
}

function followUpTextStream() {
  return convertArrayToReadableStream([
    { type: "stream-start", warnings: [] },
    {
      type: "response-metadata",
      id: "id-1",
      modelId: "mock-model-id",
      timestamp: new Date(0),
    },
    { type: "text-start", id: "text-1" },
    { type: "text-delta", id: "text-1", delta: "Should not run" },
    { type: "text-end", id: "text-1" },
    {
      type: "finish",
      finishReason: { unified: "stop", raw: "stop" },
      usage: STREAM_USAGE,
    },
  ]);
}

describe("finalizeReportTool", () => {
  it("returns a Mastra tool with id finalize_report and typed input schema", () => {
    const tool = finalizeReportTool();
    expect(tool.id).toBe("finalize_report");
    expect(tool.inputSchema).toBeDefined();
    const parsed = tool.inputSchema!.parse(FINALIZE_INPUT);
    expect(parsed).toEqual(FINALIZE_INPUT);
  });

  it("execute returns sql, csvResults, narrative, and a workspace path", async () => {
    const tool = finalizeReportTool();
    const result = (await tool.execute!(FINALIZE_INPUT, {})) as {
      sql: string;
      csvResults: string;
      narrative: string;
      path: string;
    };
    expect(result.sql).toBe(FINALIZE_INPUT.sql);
    expect(result.csvResults).toBe(FINALIZE_INPUT.csvResults);
    expect(result.narrative).toBe(FINALIZE_INPUT.narrative);
    expect(result.path).toMatch(/^reports\/.+\.md$/);
  });
});

describe("shouldRegisterFinalizeReport", () => {
  it("is true for sandboxed workspace when finalizeReport is not false", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "arivie-finalize-reg-"));
    const filesystem = new InProcessSandboxFilesystem({ rootDir });
    const workspace = new Workspace({ filesystem });
    expect(shouldRegisterFinalizeReport(workspace, true)).toBe(true);
    expect(shouldRegisterFinalizeReport(workspace, undefined)).toBe(true);
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it("is false for local workspace or finalizeReport false", async () => {
    const { workspace: local } = await makeWorkspace({
      rootDir: "/tmp/arivie-finalize-local",
    });
    expect(shouldRegisterFinalizeReport(local, true)).toBe(false);

    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "arivie-finalize-reg-"));
    const filesystem = new InProcessSandboxFilesystem({ rootDir });
    const sandboxed = new Workspace({ filesystem });
    expect(shouldRegisterFinalizeReport(sandboxed, false)).toBe(false);
    await fs.rm(rootDir, { recursive: true, force: true });
  });
});

describe("finalizeReportStopWhen", () => {
  it("returns true when a step has a Mastra finalize_report tool call payload", () => {
    expect(
      finalizeReportStopWhen({
        steps: [
          {
            toolCalls: [
              {
                type: "tool-call",
                payload: { toolName: "finalize_report" },
              },
            ],
          },
        ],
      }),
    ).toBe(true);
  });

  it("returns true when a step has a Mastra finalize_report tool result payload", () => {
    expect(
      finalizeReportStopWhen({
        steps: [
          {
            toolResults: [
              {
                type: "tool-result",
                payload: { toolName: "finalize_report" },
              },
            ],
          },
        ],
      }),
    ).toBe(true);
  });

  it("returns false before finalize_report runs", () => {
    expect(
      finalizeReportStopWhen({
        steps: [
          {
            toolCalls: [
              { payload: { toolName: "execute_postgres" } },
            ],
          },
        ],
      }),
    ).toBe(false);
  });
});

describe("finalize_report stream termination (stopWhen)", () => {
  it("stops agent.stream after one finalize_report call via stopWhen", async () => {
    let modelCallCount = 0;
    const model = new MockLanguageModelV3({
      provider: "mock",
      modelId: "mock",
      doStream: async () => {
        modelCallCount += 1;
        if (modelCallCount === 1) {
          return { stream: finalizeReportToolCallStream() };
        }
        return { stream: followUpTextStream() };
      },
    });

    const agent = new Agent({
      id: "finalize-report-test",
      name: "Finalize report test",
      instructions: "Call finalize_report when done.",
      model,
      tools: {
        finalize_report: finalizeReportTool(),
        execute_postgres: executeToolFor({
          db: mockDb(),
          ownerId: "owner-1",
          sourceName: "postgres",
          limits: {},
          toolId: "execute_postgres",
        }),
      },
      defaultOptions: { stopWhen: finalizeReportStopWhen },
    });

    const started = Date.now();
    const stream = await agent.stream("Finalize the report", {
      toolChoice: "required",
    });

    let stepStartCount = 0;
    let sawFinalizeToolCall = false;
    for await (const chunk of stream.fullStream) {
      if (chunk.type === "step-start") {
        stepStartCount += 1;
      }
      if (
        chunk.type === "tool-call" &&
        "payload" in chunk &&
        chunk.payload.toolName === "finalize_report"
      ) {
        sawFinalizeToolCall = true;
      }
    }

    await stream.consumeStream();
    const elapsedMs = Date.now() - started;

    expect(sawFinalizeToolCall).toBe(true);
    expect(modelCallCount).toBe(1);
    expect(stepStartCount).toBe(1);
    expect(elapsedMs).toBeLessThan(5_000);

    const toolResults = await stream.toolResults;
    const finalizeResult = toolResults.find(
      (result) => result.payload.toolName === "finalize_report",
    );
    expect(finalizeResult?.payload.result).toMatchObject(FINALIZE_INPUT);
    expect(finalizeResult?.payload.result).toHaveProperty("path");
  }, 30_000);
});

describe("finalize_report generate termination (stopWhen)", () => {
  it("stops agent.generate after one finalize_report call via stopWhen", async () => {
    let modelCallCount = 0;
    const model = new MockLanguageModelV3({
      provider: "mock",
      modelId: "mock",
      doGenerate: async () => {
        modelCallCount += 1;
        if (modelCallCount === 1) {
          return {
            content: [
              {
                type: "tool-call",
                toolCallId: "call-finalize-gen-1",
                toolName: "finalize_report",
                input: JSON.stringify(FINALIZE_INPUT),
              },
            ],
            finishReason: { unified: "tool-calls", raw: "tool_calls" },
            usage: STREAM_USAGE,
            warnings: [],
          };
        }
        return {
          content: [{ type: "text", text: "Should not run" }],
          finishReason: { unified: "stop", raw: "stop" },
          usage: STREAM_USAGE,
          warnings: [],
        };
      },
    });

    const agent = new Agent({
      id: "finalize-report-generate-test",
      name: "Finalize report generate test",
      instructions: "Call finalize_report when done.",
      model,
      tools: { finalize_report: finalizeReportTool() },
      defaultOptions: { stopWhen: finalizeReportStopWhen },
    });

    const result = await agent.generate("Finalize the report", {
      toolChoice: "required",
    });

    expect(modelCallCount).toBe(1);
    const steps = (result as { steps?: { toolResults?: { payload: { toolName: string; result: unknown } }[] }[] }).steps ?? [];
    const finalizeResult = steps
      .flatMap((step) => step.toolResults ?? [])
      .find((entry) => entry.payload.toolName === "finalize_report");
    expect(finalizeResult?.payload.result).toMatchObject(FINALIZE_INPUT);
    expect(finalizeResult?.payload.result).toHaveProperty("path");
  }, 30_000);
});
