/* SPDX-License-Identifier: Apache-2.0 */
// Aurora Support — a customer-support agent built ENTIRELY on the context layer.
// No analytics, no SQL, no database: just an agent + a governed knowledge base.
// `always` pages (policy) inject every turn; `auto` pages (the FAQ) are
// retrieved on demand via Mastra RAG.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createOpenAI } from "@ai-sdk/openai";
import {
  defineAgent,
  defineArivie,
  InMemoryRuntimeStorage,
  mastraRagRetriever,
  type ArivieAppConfig,
} from "@arivie/core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const contextRoot = join(__dirname, "context");

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value == null || value === "") throw new Error(`${name} is required`);
  return value;
}

const openai = createOpenAI({ apiKey: requireEnv("OPENAI_API_KEY") });

export const config: ArivieAppConfig = {
  app: { id: "aurora-support", name: "Aurora Support" },
  model: openai(process.env.OPENAI_MODEL ?? "gpt-4o-mini"),
  // Zero infra: durable runtime in memory, conversation memory in the default
  // LibSQL file. No Postgres, no warehouse — this agent has no database.
  storage: new InMemoryRuntimeStorage(),
  agents: {
    support: defineAgent({
      instructions:
        "You are Aurora's customer support agent. Be warm, concise, and accurate. " +
        "Answer ONLY from Aurora's knowledge base. When a question may be covered by a help " +
        "article, call search_context first and base your answer on what it returns — quote the " +
        "exact steps. If the knowledge base does not cover it, say so and offer to escalate. " +
        "Never invent policy, prices, or features.",
      // No capabilities/plugins — this agent's only tool is context retrieval.
    }),
  },
  context: {
    root: contextRoot,
    // `auto` FAQ pages → embedded + retrievable via Mastra RAG (any MastraVector).
    retriever: mastraRagRetriever({
      embedding: process.env.EMBEDDING_MODEL ?? "openai/text-embedding-3-small",
    }),
  },
  resolveUser: async () => ({ userId: "customer", permissions: [] }),
};

export default config;
export const arivie = await defineArivie(config);
