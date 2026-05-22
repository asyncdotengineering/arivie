/* SPDX-License-Identifier: Apache-2.0 */
export type {
  BuildIndexResult,
  Chunk,
  Chunker,
  EmbeddingProvider,
} from "./types.js";
export { ParagraphChunker } from "./chunker.js";
export { buildIndex } from "./build-index.js";
export { retrieve } from "./retrieve.js";
export { openAIEmbeddings } from "./providers/openai.js";
export type { OpenAIEmbeddingModelId } from "./providers/openai.js";
export { cohereEmbeddings } from "./providers/cohere.js";
export { voyageEmbeddings } from "./providers/voyage.js";
export { embed, embedMany } from "ai";
export type { EmbedManyResult, Embedding } from "ai";
