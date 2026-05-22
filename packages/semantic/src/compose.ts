/* SPDX-License-Identifier: Apache-2.0 */
import type { Catalog, Entity, SemanticLayer } from "./types.js";

export interface ComposeSemanticOptions {
  /** Entities authored via `defineEntity()` or parsed from YAML. */
  entities: Entity[];
  /**
   * Optional overrides for the catalog. By default the catalog is
   * derived from the entities (one row per entity, keywords inferred
   * from the name). Pass overrides if you want custom keywords or to
   * pin a generated_at timestamp.
   */
  catalog?: Partial<Catalog>;
}

/**
 * Build a {@link SemanticLayer} from in-memory entities. Use this when
 * you want to author entities in TypeScript instead of YAML, then feed
 * the layer to `defineArivie` via `semantic.layer`:
 *
 * ```ts
 * import { defineEntity, composeSemantic } from "@arivie/semantic";
 * import { defineArivie } from "@arivie/core";
 *
 * const orders = defineEntity({
 *   name: "orders",
 *   description: "Customer orders.",
 *   grain: "one row per order",
 *   primary_key: "id",
 *   measures: [{ name: "revenue", description: "Net revenue", sql: "SUM(total_amount)" }],
 * });
 *
 * const customers = defineEntity({ name: "customers", ... });
 *
 * const instance = await defineArivie({
 *   semantic: {
 *     layer: composeSemantic({ entities: [orders, customers] }),
 *     mode: "preload",
 *     path: "",
 *   },
 *   ...
 * });
 * ```
 *
 * Equivalent to authoring the same entities as `semantic/entities/<name>.yml`
 * files and pointing `semantic.path` at the directory — both routes produce
 * the same SemanticLayer shape and the agent treats them identically.
 */
export function composeSemantic(opts: ComposeSemanticOptions): SemanticLayer {
  const entitiesMap = new Map<string, Entity>(
    opts.entities.map((entity) => [entity.name, entity]),
  );

  const defaultCatalog: Catalog = {
    entities: [...entitiesMap.values()]
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((entity) => ({
        name: entity.name,
        description: entity.description,
        keywords: entity.name.split(/[_\s-]+/).filter(Boolean),
      })),
    generated_at: new Date().toISOString(),
    source_files: [],
  };

  return {
    entities: entitiesMap,
    catalog: {
      ...defaultCatalog,
      ...(opts.catalog ?? {}),
      entities: opts.catalog?.entities ?? defaultCatalog.entities,
    },
  };
}
