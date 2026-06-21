/* SPDX-License-Identifier: Apache-2.0 */
import type { ContextSchemaDefinition } from "@arivie/context";
import { EntitySchema } from "@arivie/semantic";

export const analyticsEntityContextSchema = {
  id: "analytics.entity",
  kind: "executable",
  description:
    "Analytics semantic-layer entity YAML describing measures, dimensions, joins, and source routing.",
  schema: EntitySchema,
} satisfies ContextSchemaDefinition;
