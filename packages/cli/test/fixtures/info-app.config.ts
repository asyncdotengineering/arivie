/* SPDX-License-Identifier: Apache-2.0 */
// Self-contained app fixture for `arivie info` tests — no external env, no
// Docker, no network. In-memory storage + a mock model + a demo plugin.
import {
  defineAgent,
  defineArivie,
  definePlugin,
  InMemoryRuntimeStorage,
} from "@arivie/core";
import { MockLanguageModelV3 } from "ai/test";

const demo = definePlugin({
  id: "demo",
  version: "1.0.0",
  permissions: [{ id: "database.read", description: "read sources" }],
  capabilities: [
    {
      id: "demo.help",
      title: "Help",
      description: "General help capability.",
      requiredPermissions: ["database.read"],
    },
  ],
  contextSchemas: [{ id: "demo.note", kind: "knowledge" }],
  setup: () => ({ instructions: "You are a demo assistant." }),
})(undefined);

const model = new MockLanguageModelV3({
  provider: "mock",
  modelId: "mock",
  doGenerate: {
    content: [{ type: "text", text: "ok" }],
    finishReason: "stop",
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    warnings: [],
  },
});

export default await defineArivie({
  app: { id: "info-test", name: "Info Test App" },
  model,
  storage: new InMemoryRuntimeStorage(),
  plugins: [demo],
  agents: {
    helper: defineAgent({ instructions: "Be brief.", capabilities: ["demo.help"] }),
  },
  resolveUser: async () => ({ userId: "u1" }),
});
