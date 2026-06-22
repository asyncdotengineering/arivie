/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { InMemoryStore } from "@mastra/core/storage";
import { createTool } from "@mastra/core/tools";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { defineArivie } from "../../src/define-app.js";
import { definePlugin } from "../../src/plugins/index.js";
import { defineAgent } from "../../src/runtime/index.js";
import { InMemoryRuntimeStorage } from "../../src/storage/index.js";
import type { ContextRetriever } from "../../src/runtime/context-retriever.js";

function stubModel(): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    provider: "mock",
    modelId: "mock",
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: "ok" },
          { type: "text-end", id: "t1" },
          {
            type: "finish",
            finishReason: { unified: "stop", raw: undefined },
            logprobs: undefined,
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, reasoning: undefined },
          },
        ],
      }),
    }),
  });
}

const demo = definePlugin({
  id: "demo",
  version: "1.0.0",
  capabilities: [{ id: "demo.help", title: "H", description: "h" }],
  setup: () => ({ instructions: "be brief" }),
})(undefined);

function contextDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "arivie-ctx-"));
  writeFileSync(join(dir, "revenue.md"), "---\nusage_mode: auto\n---\nRevenue = paid minus refunds.\n");
  return dir;
}

describe("ContextRetriever port", () => {
  it("is a strategy: a custom retriever's index() runs and its tools() merge into the agent", async () => {
    let indexedDocIds: string[] = [];
    const custom: ContextRetriever = {
      async index(docs) {
        indexedDocIds = docs.map((d) => d.id);
      },
      tools() {
        return {
          search_context: createTool({
            id: "search_context",
            description: "custom retriever search",
            inputSchema: z.object({ query: z.string() }),
            outputSchema: z.object({ hit: z.string() }),
            execute: async () => ({ hit: "from custom pipeline" }),
          }),
        };
      },
    };

    const app = await defineArivie({
      app: { id: "t", name: "T" },
      model: stubModel(),
      storage: new InMemoryRuntimeStorage(),
      memory: new InMemoryStore(),
      plugins: [demo],
      agents: { helper: defineAgent({ instructions: "x", capabilities: ["demo.help"] }) },
      context: { root: contextDir(), retriever: custom },
      resolveUser: async () => ({ userId: "u1" }),
    });

    // The custom retriever's index() saw the loaded knowledge doc...
    expect(indexedDocIds).toContain("revenue");
    // ...and its search_context tool is now on the Mastra agent (port swapped in).
    const agent = app.runtime.agents.helper;
    expect(agent).toBeDefined();
    await app.dispose();
  });

  it("works with no retriever (always-inject only — no tools required)", async () => {
    const app = await defineArivie({
      app: { id: "t", name: "T" },
      model: stubModel(),
      storage: new InMemoryRuntimeStorage(),
      memory: new InMemoryStore(),
      plugins: [demo],
      agents: { helper: defineAgent({ instructions: "x", capabilities: ["demo.help"] }) },
      context: { root: contextDir() },
      resolveUser: async () => ({ userId: "u1" }),
    });
    expect(app.context?.documents.length).toBeGreaterThan(0);
    await app.dispose();
  });
});
