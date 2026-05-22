/* SPDX-License-Identifier: Apache-2.0 */
import { z } from "zod";

export interface UseAgentOptions {
  endpoint: string;
  initialMessages?: Message[];
  onError?: (err: Error) => void;
}

export interface UseAgentReturn {
  messages: Message[];
  status: "idle" | "thinking" | "querying" | "streaming";
  submit: (question: string) => void;
  abort: () => void;
  reset: () => void;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  sql?: string;
  rows?: Record<string, unknown>[];
  assumptions?: { key: string; value: string }[];
  timeline?: ToolEvent[];
  cost?: { promptTokens: number; completionTokens: number; usd: number };
}

export interface ToolEvent {
  /** v0.2: `execute_<sourceName>` (e.g. `execute_postgres`) or `compile_metric`. */
  tool: string;
  args: Record<string, unknown>;
  durationMs: number;
  result_summary: string;
}

export interface UseSchemaOptions {
  endpoint: string;
}

export type SchemaFetchStatus = "idle" | "loading" | "error";

export interface SchemaOwner {
  id: string;
  name: string;
}

export interface UseSchemaReturn {
  catalog: Record<string, unknown> | null;
  entities: Record<string, unknown>[];
  owner: SchemaOwner | null;
  status: SchemaFetchStatus;
  refetch: () => void;
}

export interface UseMemoryOptions {
  endpoint: string;
}

export type MemoryFetchStatus = "idle" | "loading" | "error";

export interface MemoryEntry {
  key: string;
  value: string;
}

export interface UseMemoryReturn {
  memories: MemoryEntry[];
  save: (key: string, value: string) => Promise<void>;
  remove: (key: string) => Promise<void>;
  status: MemoryFetchStatus;
}

const OwnerSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export const SchemaResponseSchema = z.object({
  catalog: z.record(z.string(), z.unknown()),
  entities: z.array(z.record(z.string(), z.unknown())),
  owner: OwnerSchema,
});

export const MemoryListSchema = z.object({
  memories: z.array(
    z.object({
      key: z.string(),
      value: z.string(),
    }),
  ),
});

export const MemoryMutationSchema = z.object({
  memories: z.array(
    z.object({
      key: z.string(),
      value: z.string(),
    }),
  ),
});
