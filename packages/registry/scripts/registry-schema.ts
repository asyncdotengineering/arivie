/* SPDX-License-Identifier: Apache-2.0 */
import { z } from "zod";

export const RegistryFileEntrySchema = z.object({
  path: z.string().min(1),
  type: z.literal("registry:component"),
});

export const RegistryItemSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9-]*$/),
  type: z.literal("registry:ui"),
  version: z.string().min(1),
  files: z.array(RegistryFileEntrySchema).min(1),
  dependencies: z.array(z.string()),
  shadcnDependencies: z.array(z.string()),
  description: z.string().min(1),
});

export type RegistryItem = z.infer<typeof RegistryItemSchema>;

export const COMPONENT_DIRS = [
  "agent-chat",
  "sql-inspector",
  "run-timeline",
  "eval-diff",
  "semantic-browser",
  "memory-editor",
  "workflow-list",
  "owner-context-badge",
] as const;
