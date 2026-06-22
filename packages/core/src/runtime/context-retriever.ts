/* SPDX-License-Identifier: Apache-2.0 */
import type { ContextDocument } from "@arivie/context";
import { ModelRouterEmbeddingModel } from "@mastra/core/llm";
import type { Tool } from "@mastra/core/tools";
import type { MastraVector } from "@mastra/core/vector";
import { LibSQLVector } from "@mastra/libsql";
import { MDocument, createVectorQueryTool } from "@mastra/rag";
import { type EmbeddingModel, embedMany } from "ai";
import { usageModeOf } from "./context-layer.js";

/**
 * The retrieval STRATEGY for `usage_mode: auto` knowledge pages (ADR 0003).
 * A port (ports & adapters) — Arivie owns governance (load, sl_refs, usage_mode,
 * always-inject); the retriever owns the mechanics. `defineArivie` calls
 * `index()` once at startup, then merges `tools()` into every agent so the model
 * can search the context. Bring the default {@link mastraRagRetriever}, or
 * implement this interface to plug in ANY pipeline (hybrid, GraphRAG, remote).
 */
export interface ContextRetriever {
  /** Build/refresh the index from the knowledge docs at app startup (optional). */
  index?(docs: ContextDocument[]): Promise<void>;
  /** Agent tools that search the context (merged into every agent's toolset). */
  tools(): Record<string, Tool>;
}

export interface MastraRagRetrieverOptions {
  /** Embedding model — an `"openai/text-embedding-3-small"` id (Mastra model router) or an AI SDK `EmbeddingModel`. */
  embedding: string | EmbeddingModel;
  /** Any Mastra vector store (PgVector, LibSQLVector, Pinecone, …). Defaults to a zero-infra LibSQL file. */
  vector?: MastraVector;
  /** Vector index name. */
  indexName?: string;
  /** Chunking — passed to `MDocument.chunk`. */
  chunk?: { strategy?: "markdown" | "recursive" | "token" | "character" | "sentence"; maxSize?: number; overlap?: number };
}

/**
 * Default {@link ContextRetriever} over Mastra's `@mastra/rag` — chunks `auto`
 * knowledge pages (`MDocument`), embeds them, upserts into any `MastraVector`,
 * and exposes Mastra's `createVectorQueryTool` to the agent. Swap `vector` for
 * any Mastra store; implement `ContextRetriever` yourself to swap the whole
 * pipeline.
 */
export function mastraRagRetriever(options: MastraRagRetrieverOptions): ContextRetriever {
  const model =
    typeof options.embedding === "string"
      ? new ModelRouterEmbeddingModel(options.embedding)
      : options.embedding;
  const store =
    options.vector ?? new LibSQLVector({ id: "arivie-context", url: "file:.arivie/context.db" });
  const indexName = options.indexName ?? "arivie_context";

  return {
    async index(docs: ContextDocument[]): Promise<void> {
      const auto = docs.filter(
        (doc) => doc.kind === "knowledge" && usageModeOf(doc) === "auto" && (doc.body ?? "").trim().length > 0,
      );
      if (auto.length === 0) return;

      const chunks: { text: string; docId: string }[] = [];
      for (const doc of auto) {
        const md = MDocument.fromMarkdown(doc.body ?? "", { id: doc.id });
        const parts = await md.chunk({
          strategy: options.chunk?.strategy ?? "markdown",
          maxSize: options.chunk?.maxSize ?? 512,
          overlap: options.chunk?.overlap ?? 50,
        });
        for (const part of parts) chunks.push({ text: part.text, docId: doc.id });
      }
      if (chunks.length === 0) return;

      const { embeddings } = await embedMany({
        model: model as EmbeddingModel,
        values: chunks.map((chunk) => chunk.text),
      });
      const dimension = embeddings[0]?.length ?? 0;
      if (dimension === 0) return;

      await store.createIndex({ indexName, dimension });
      await store.upsert({
        indexName,
        vectors: embeddings,
        metadata: chunks.map((chunk) => ({ text: chunk.text, docId: chunk.docId })),
      });
    },
    tools(): Record<string, Tool> {
      const tool = createVectorQueryTool({
        vectorStore: store,
        indexName,
        // Interop: createVectorQueryTool wants Mastra's embedding model type;
        // ModelRouterEmbeddingModel satisfies it. Cast to the exact param type.
        model: model as Parameters<typeof createVectorQueryTool>[0]["model"],
        id: "search_context",
        description:
          "Search the app's knowledge/context pages (definitions, business rules, glossary) for relevant passages. Use before answering when a term or rule may be defined in context.",
      }) as unknown as Tool;
      return { search_context: tool };
    },
  };
}
