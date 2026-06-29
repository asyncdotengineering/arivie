/* SPDX-License-Identifier: Apache-2.0 */
import { loadContextLayer } from "./load.js";
import type { ProvenanceRecord } from "./provenance.js";
import type { ContextSchemaDefinition } from "./schemas.js";

export type { ContextSchemaDefinition } from "./schemas.js";
export type { ProvenanceRecord } from "./provenance.js";
export { createProvenanceRecord, hashSourceContent } from "./provenance.js";
export { ContextError, ContextLoadError } from "./errors.js";

export interface ContextLayerConfig {
  root: string;
  schemas?: ContextSchemaDefinition[];
  knownSemanticIds?: string[];
  indexing?: {
    mode: "none" | "lexical" | "hybrid";
    embeddings?: unknown;
  };
}

export interface ContextDocument {
  id: string;
  kind: "knowledge" | "executable";
  type?: string;
  schema: string;
  path: string;
  frontmatter: Record<string, unknown>;
  body?: string;
  data?: unknown;
  refs?: string[];
  provenance?: ProvenanceRecord[];
}

export interface ContextValidationIssue {
  severity: "error" | "warning";
  message: string;
  path?: string;
  detail?: Record<string, unknown>;
}

export interface ContextLayerLoadResult {
  documents: ContextDocument[];
  issues: ContextValidationIssue[];
  catalog: string;
}

export interface ContextLayer {
  config: ContextLayerConfig;
  load(): Promise<ContextLayerLoadResult>;
  get(id: string): ContextDocument | undefined;
  all(): ContextDocument[];
  index(): string;
}

export function defineContextLayer(config: ContextLayerConfig): ContextLayer {
  let loadedDocuments: ContextDocument[] = [];
  let loadedCatalog = "";

  return {
    config,
    async load() {
      const result = await loadContextLayer(config);
      loadedDocuments = result.documents;
      loadedCatalog = result.catalog;
      return result;
    },
    get(id: string) {
      return loadedDocuments.find((document) => document.id === id);
    },
    all() {
      return [...loadedDocuments];
    },
    index() {
      return loadedCatalog;
    },
  };
}
