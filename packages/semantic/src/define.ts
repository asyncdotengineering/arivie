/* SPDX-License-Identifier: Apache-2.0 */
import { EntitySchema } from "./schema.js";
import type { Entity } from "./types.js";

/**
 * TypeScript-first entity authoring. The same `Entity` shape you'd get
 * from parsing a YAML file, but written inline with full IDE autocomplete,
 * type narrowing on enum-valued dimensions, and a compile-time guarantee
 * that the measures/dimensions/segments arrays are well-typed.
 *
 * ```ts
 * import { defineEntity } from "@arivie/semantic";
 *
 * export const orders = defineEntity({
 *   name: "orders",
 *   description: "Orders placed by customers.",
 *   grain: "one row per order",
 *   primary_key: "id",
 *   measures: [
 *     { name: "revenue", description: "Total revenue", sql: "SUM(total_amount)" },
 *   ],
 *   dimensions: [
 *     { name: "status", sql: "status", values: ["pending", "completed"] },
 *   ],
 * });
 * ```
 *
 * The input is validated through `EntitySchema` so misuse fails at module
 * load time with a Zod error pointing at the bad field — same defaults
 * applied as the YAML loader (e.g. `source` defaults to
 * `{ adapter: "postgres", instance: "primary" }`).
 */
export function defineEntity(input: unknown): Entity {
  return EntitySchema.parse(input) as Entity;
}
