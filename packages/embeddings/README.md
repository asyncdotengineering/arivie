# @arivie/embeddings

Provider adapters for RAG embedding: thin factories over AI SDK v6 (`@ai-sdk/openai`, `@ai-sdk/cohere`, `@ai-sdk/voyage`) that return an `EmbeddingProvider` record (`model`, `modelName`, `dimensions`, `costPerMillionTokens`). Downstream code calls `embedMany({ model: provider.model, values })` using the re-exported `embed` / `embedMany` from this package — no Arivie-owned embed wrapper.

```ts
import { embedMany, openAIEmbeddings } from "@arivie/embeddings";

const provider = openAIEmbeddings({ apiKey: process.env.OPENAI_API_KEY! });
const { embeddings, usage } = await embedMany({
  model: provider.model,
  values: ["chunk one", "chunk two"],
});
// cost rollup (e.g. buildIndex): usage.tokens * provider.costPerMillionTokens / 1_000_000
```

All three providers use `createProvider({ apiKey }).embedding(modelId)` (AI SDK v6 idiom). Cohere and Voyage accept arbitrary `model` strings at runtime; metadata `dimensions` defaults are caller overrides when the model variant differs from the package default.

## buildIndex

Chunk a semantic layer with `ParagraphChunker`, embed via `embedMany`, and upsert into a Mastra vector store (typically `PgVector`):

```ts
import { PgVector } from "@mastra/pg";
import { buildIndex, openAIEmbeddings } from "@arivie/embeddings";

const provider = openAIEmbeddings({ apiKey: process.env.OPENAI_API_KEY! });
const vector = new PgVector({
  id: "arivie-rag",
  connectionString: process.env.DATABASE_URL!,
});

const { chunkCount, totalEmbeddingCost } = await buildIndex({
  layer,
  provider,
  vector,
  indexName: "sem",
});
```

Returns `{ chunkCount, totalEmbeddingCost }` where cost is `usage.tokens × provider.costPerMillionTokens / 1_000_000` summed across embedding batches.

## retrieve

Embed a single query string, run similarity search against a populated index, and return ranked `Chunk[]` (same shape as `ParagraphChunker`):

```ts
import { PgVector } from "@mastra/pg";
import { buildIndex, openAIEmbeddings, retrieve } from "@arivie/embeddings";

const provider = openAIEmbeddings({ apiKey: process.env.OPENAI_API_KEY! });
const vector = new PgVector({
  id: "arivie-rag",
  connectionString: process.env.DATABASE_URL!,
});

await buildIndex({ layer, provider, vector, indexName: "sem" });

const chunks = await retrieve({
  query: "monthly revenue by region",
  vector,
  indexName: "sem",
  provider,
  topK: 5,
  entityHint: "orders", // optional metadata filter: { entity: "orders" }
});
```

Uses AI SDK `embed` (single value) for the query vector, then `vector.query` with optional `entityHint` filter. Results are sorted by descending similarity score.

Contract and RAG pipeline: [RFC-002 §4.4](../../../.research/07-rfc/RFC-002-concrete-tech-implementation/02-requirements-interfaces.md#44-anaclipembeddings--rag-mode-mastra-vector-extension) (amended in Sprint 2 — `EmbeddingProvider` holds `EmbeddingModel` + cost metadata, not a custom `embed()` method).
