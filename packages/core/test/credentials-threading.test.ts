/* SPDX-License-Identifier: Apache-2.0 */
import { runWithUserContext } from "@arivie/core/context";
import type { SourceAdapter } from "@arivie/core/types";
import type { SemanticLayer } from "@arivie/semantic";
import { makeWorkspace } from "@arivie/workspace";
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { makeAgent } from "../../agent/src/make-agent.js";

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

function recordingAdapter(sourceName: string): SourceAdapter<unknown> {
  const execute = vi.fn().mockResolvedValue({
    rows: [],
    rowCount: 0,
    durationMs: 0,
    truncated: false,
  });
  return {
    kind: "postgres",
    id: `postgres:test/${sourceName}`,
    url: "postgres://test",
    sql: {} as SourceAdapter<unknown> & { sql?: unknown },
    execute,
    introspect: async () => [],
    verifyOwnerIdentity: async () => {},
    setupRole: async () => {},
    _execute: execute,
  } as SourceAdapter<unknown> & {
    _execute: ReturnType<typeof vi.fn>;
    url: string;
    sql: unknown;
    setupRole: () => Promise<void>;
  };
}

const stubModel = new MockLanguageModelV3({
  provider: "mock",
  modelId: "mock",
  doGenerate: {
    content: [{ type: "text", text: "ok" }],
    finishReason: "stop",
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    warnings: [],
  },
});

describe("resolveUser.credentials threading (REQ-46)", () => {
  it("passes credentials[sourceName] into adapter.execute", async () => {
    const analytics = recordingAdapter("analytics");
    const { workspace } = await makeWorkspace({
      rootDir: "/tmp/arivie-credentials-test",
    });

    const agent = makeAgent({
      ownerId: "owner-1",
      model: stubModel,
      semantic: emptySemantic(),
      contextMode: "preload",
      sources: { analytics },
      workspace,
      limits: {},
      config: { compile_metric: false, workspace: { finalizeReport: false } },
    });

    const tools = await agent.listTools();
    const executeTool = tools.execute_analytics;
    expect(executeTool).toBeDefined();

    const token = { apiKey: "secret-key" };
    await runWithUserContext(
      {
        userId: "user-1",
        permissions: [],
        dbRole: "arivie_reader",
        credentials: { analytics: token },
      },
      () =>
        executeTool.execute!(
          { sql: "SELECT 1" },
          {},
        ),
    );

    expect(analytics._execute).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "SELECT 1",
        credentials: token,
        userId: "user-1",
        runAsRole: "arivie_reader",
      }),
    );
  });

  it("omits credentials when resolveUser did not supply them for the source", async () => {
    const warehouse = recordingAdapter("warehouse");
    const { workspace } = await makeWorkspace({
      rootDir: "/tmp/arivie-credentials-missing-test",
    });

    const agent = makeAgent({
      ownerId: "owner-1",
      model: stubModel,
      semantic: emptySemantic(),
      contextMode: "preload",
      sources: { warehouse },
      workspace,
      limits: {},
      config: { compile_metric: false, workspace: { finalizeReport: false } },
    });

    const tools = await agent.listTools();
    await runWithUserContext(
      {
        userId: "user-1",
        permissions: [],
        dbRole: "arivie_reader",
      },
      () =>
        tools.execute_warehouse.execute!(
          { sql: "SELECT 1" },
          {},
        ),
    );

    const call = warehouse._execute.mock.calls[0]?.[0];
    expect(call).toBeDefined();
    expect(call).not.toHaveProperty("credentials");
  });
});
