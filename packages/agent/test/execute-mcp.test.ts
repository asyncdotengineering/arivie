/* SPDX-License-Identifier: Apache-2.0 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runWithUserContext } from "@arivie/core/context";
import { makeMCPSourceAdapter } from "@arivie/source-mcp";
import { makeWorkspace } from "@arivie/workspace";
import { MockLanguageModelV3 } from "ai/test";
import { afterEach, describe, expect, it } from "vitest";
import type { SemanticLayer } from "@arivie/semantic";
import { makeAgent } from "../src/make-agent.js";

const mockServerPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../source-mcp/test/fixtures/mock-server.ts",
);

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

describe("execute_mock (MCP-backed execute_<source>)", () => {
  const adapters: { close?: () => Promise<void> }[] = [];

  afterEach(async () => {
    while (adapters.length > 0) {
      const adapter = adapters.pop();
      if (adapter?.close) {
        await adapter.close();
      }
    }
  });

  it("invokes execute_mock with toolName and args", async () => {
    const { adapter } = await makeMCPSourceAdapter({
      name: "mock",
      serverConfig: {
        command: "tsx",
        args: [mockServerPath],
      },
    });
    adapters.push(adapter);

    const { workspace } = await makeWorkspace({
      rootDir: "/tmp/arivie-execute-mcp-test",
    });
    const agent = makeAgent({
      ownerId: "owner-1",
      model: stubModel,
      semantic: emptySemantic(),

      sources: { mock: adapter },
      workspace,
      limits: {},
      config: { compile_metric: false, workspace: { finalizeReport: false } },
    });

    const tools = await agent.listTools();
    expect(tools).toHaveProperty("execute_mock");

    const user = {
      userId: "u1",
      permissions: [] as string[],
      dbRole: "arivie_reader",
    };

    const result = await runWithUserContext(user, () =>
      tools.execute_mock!.execute!(
        { toolName: "mock_query", args: { filter: "active" } },
        {},
      ),
    );

    expect(result.rowCount).toBe(1);
    expect(result.rows[0]).toMatchObject({ tool: "mock_query", ok: true });
    expect(result.truncated).toBe(false);
  }, 60_000);
});
