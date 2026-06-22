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
export { modelRouterEmbeddings } from "./providers/model-router.js";
export type { ModelRouterEmbeddingsOptions } from "./providers/model-router.js";
export { embed, embedMany } from "ai";
export type { EmbedManyResult, Embedding } from "ai";
