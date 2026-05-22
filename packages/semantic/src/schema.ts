/* SPDX-License-Identifier: Apache-2.0 */
import { z } from "zod";

export const MeasureSchema = z
  .object({
    name: z.string().min(1),
    description: z.string(),
    sql: z.string().min(1),
  })
  .strict();

export const DimensionSchema = z
  .object({
    name: z.string().min(1),
    sql: z.string().min(1),
    type: z.enum(["text", "numeric", "timestamp", "date", "boolean"]).optional(),
    values: z.array(z.union([z.string(), z.number()])).optional(),
    description: z.string().optional(),
  })
  .strict();

export const SegmentSchema = z
  .object({
    name: z.string().min(1),
    sql: z.string().min(1),
    description: z.string().optional(),
  })
  .strict();

export const JoinSchema = z
  .object({
    to: z.string().min(1),
    on: z.string().min(1),
    type: z
      .enum(["one_to_one", "one_to_many", "many_to_one", "many_to_many"])
      .optional(),
    strategy: z.enum(["client-side", "materialised"]).optional(),
  })
  .strict();

export const ColumnSchema = z
  .object({
    name: z.string().min(1),
    type: z.string().min(1),
    description: z.string(),
    pii: z.boolean().optional().default(false),
    values: z.array(z.union([z.string(), z.number()])).optional(),
    units: z.string().optional(),
  })
  .strict();

export const ExampleQuerySchema = z
  .object({
    question: z.string(),
    sql: z.string(),
  })
  .strict();

export const EntitySourceSchema = z
  .object({
    adapter: z.string().default("postgres"),
    instance: z.string().default("primary"),
  })
  .strict()
  .default({ adapter: "postgres", instance: "primary" });

export const EntitySchema = z
  .object({
    name: z.string().min(1),
    description: z.string(),
    grain: z.string(),
    primary_key: z.string(),
    source: EntitySourceSchema,
    schema: z.string().optional(),
    measures: z.array(MeasureSchema).optional(),
    dimensions: z.array(DimensionSchema).optional(),
    segments: z.array(SegmentSchema).optional(),
    joins: z.array(JoinSchema).optional(),
    columns: z.array(ColumnSchema).optional(),
    example_questions: z.array(z.string()).optional(),
    example_queries: z.array(ExampleQuerySchema).optional(),
    hints: z.array(z.string().min(1)).min(1).optional(),
  })
  .strict();

export const CatalogSchema = z
  .object({
    entities: z.array(
      z
        .object({
          name: z.string().min(1),
          description: z.string(),
          keywords: z.array(z.string()),
        })
        .strict(),
    ),
    generated_at: z.string(),
    source_files: z.array(z.string()),
  })
  .strict();
