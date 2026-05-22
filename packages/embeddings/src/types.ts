/* SPDX-License-Identifier: Apache-2.0 */
import type { Entity } from "@arivie/semantic";
import type { EmbeddingModel } from "ai";

export interface EmbeddingProvider {
  readonly model: EmbeddingModel;
  readonly modelName: string;
  readonly dimensions: number;
  /** USD per 1,000,000 input tokens. Used by buildIndex to roll up totalEmbeddingCost. */
  readonly costPerMillionTokens: number;
  /**
   * Provider-specific options forwarded to AI SDK v6 `embed`/`embedMany`.
   * Symmetric between build and query — both `buildIndex` and `retrieve` read
   * this field. Set for Google's Matryoshka Representation Learning
   * (`{ google: { outputDimensionality: 768 } }`), Cohere's input_type, etc.
   * Without this, an index built with MRL-truncated vectors won't match the
   * query embedding's shape (KI-livedemo-1).
   */
  readonly providerOptions?: Record<string, Record<string, unknown>>;
}

export interface Chunk {
  readonly id: string;
  readonly text: string;
  readonly metadata: {
    readonly entity: string;
    readonly paragraph_idx: number;
    readonly section:
      | "description"
      | "measure"
      | "dimension"
      | "segment"
      | "example_query"
      | "hint";
    readonly name?: string;
  };
}

export interface Chunker {
  chunk(entity: Entity): Chunk[];
}

export interface BuildIndexResult {
  readonly chunkCount: number;
  readonly totalEmbeddingCost: number;
}
