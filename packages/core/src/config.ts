/* SPDX-License-Identifier: Apache-2.0 */
import type { EmbeddingProvider } from "@arivie/embeddings";
import type { SemanticLayer } from "@arivie/semantic";
import type { WorkspaceFilesystem } from "@mastra/core/workspace";
import type { MastraVector } from "@mastra/core/vector";
import type { LanguageModel } from "ai";
import { z } from "zod";
import type { ResolveUser, SourceAdapter } from "./types.js";

const ownerSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
  })
  .strict();

const embeddingProviderSchema = z.custom<EmbeddingProvider>(
  (v): v is EmbeddingProvider =>
    v != null &&
    typeof v === "object" &&
    "model" in v &&
    "dimensions" in v &&
    "modelName" in v &&
    "costPerMillionTokens" in v,
  {
    message:
      "embeddings.provider must be an EmbeddingProvider from @arivie/embeddings",
  },
);

const mastraVectorSchema = z.custom<MastraVector>(
  (v): v is MastraVector =>
    v != null &&
    typeof v === "object" &&
    typeof (v as { query?: unknown }).query === "function" &&
    typeof (v as { upsert?: unknown }).upsert === "function",
  {
    message:
      "embeddings.vector must implement Mastra's MastraVector (query + upsert)",
  },
);

const embeddingsSchema = z
  .object({
    provider: embeddingProviderSchema,
    vector: mastraVectorSchema,
    indexName: z.string().min(1),
  })
  .strict();

const semanticLayerSchema = z.custom<SemanticLayer>(
  (v): v is SemanticLayer =>
    v != null &&
    typeof v === "object" &&
    v instanceof Object &&
    "entities" in v &&
    "catalog" in v &&
    (v as { entities: unknown }).entities instanceof Map,
  {
    message:
      "semantic.layer must be a SemanticLayer from @arivie/semantic (with Map entities + catalog)",
  },
);

const REMOVED_MODES = ["browse", "filesystem", "rag"] as const;

const semanticModeSchema = z
  .string()
  .default("auto")
  .superRefine((mode, ctx) => {
    if ((REMOVED_MODES as readonly string[]).includes(mode)) {
      ctx.addIssue({
        code: "custom",
        message: `semantic.mode "${mode}" is not valid in v0.2 — use "preload" | "indexed" | "auto" (former "rag" → "indexed" with embeddings)`,
      });
      return;
    }
    if (!["auto", "preload", "indexed"].includes(mode)) {
      ctx.addIssue({
        code: "custom",
        message: 'semantic.mode must be "preload" | "indexed" | "auto"',
      });
    }
  })
  .transform((mode) => mode as "auto" | "preload" | "indexed");

const semanticSchema = z
  .object({
    path: z.string().default("./semantic"),
    mode: semanticModeSchema,
    embeddings: embeddingsSchema.optional(),
    layer: semanticLayerSchema.optional(),
  })
  .strict()
  .superRefine((semantic, ctx) => {
    if (semantic.mode === "indexed" && semantic.embeddings === undefined) {
      ctx.addIssue({
        code: "custom",
        message:
          "semantic.embeddings is required when semantic.mode is 'indexed'",
        path: ["embeddings"],
      });
    }
  });

// v0.3 shape: workspace owns filesystem + bash + bm25 + finalizeReport.
// `skills`, `skillsMode`, `compileMetric` are hoisted to the top level
// because they're high-traffic ergonomics that read better when not
// nested inside the workspace primitive.
const workspaceSchema = z
  .object({
    rootDir: z.string().optional(),
    filesystem: z.custom<WorkspaceFilesystem>().optional(),
    bash: z.boolean().optional(),
    bm25: z.boolean().optional(),
    finalizeReport: z.boolean().default(true),
  })
  .strict()
  .optional();

const sourceAdapterSchema = z.custom<SourceAdapter<unknown>>(
  (v): v is SourceAdapter<unknown> =>
    v != null &&
    typeof v === "object" &&
    "execute" in v &&
    typeof (v as { execute?: unknown }).execute === "function" &&
    "verifyOwnerIdentity" in v &&
    typeof (v as { verifyOwnerIdentity?: unknown }).verifyOwnerIdentity ===
      "function",
);

const mcpServerConfigSchema = z
  .object({
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    url: z.string().optional(),
  })
  .strict();

const sourceEntrySchema = z.union([
  sourceAdapterSchema,
  z.object({ adapter: sourceAdapterSchema }).strict(),
  z.object({ mcp: mcpServerConfigSchema }).strict(),
]);

const sourcesSchema = z
  .record(z.string().min(1), sourceEntrySchema)
  .refine((sources) => Object.keys(sources).length >= 1, {
    message: "sources must contain at least one entry",
  });

const limitSchema = z
  .object({
    rowsPerQuery: z.number().optional(),
    queryTimeoutMs: z.number().optional(),
    tokensPerRequest: z.number().optional(),
    tokensPerUserPerMonth: z.number().nullable().optional(),
    maxSteps: z.number().optional(),
  })
  .strict();

const lifecycleHooksSchema = z
  .object({
    onBeforeQuery: z.custom<(ctx: unknown) => Promise<void>>(
      (v) => typeof v === "function",
    ),
    onAfterQuery: z.custom<(ctx: unknown) => Promise<void>>(
      (v) => typeof v === "function",
    ),
    onToolCall: z.custom<(ctx: unknown) => Promise<void>>(
      (v) => typeof v === "function",
    ),
    onError: z.custom<(ctx: unknown) => Promise<void>>(
      (v) => typeof v === "function",
    ),
    onMemorySave: z.custom<(ctx: unknown) => Promise<void>>(
      (v) => typeof v === "function",
    ),
    onMemoryDelete: z.custom<(ctx: unknown) => Promise<void>>(
      (v) => typeof v === "function",
    ),
  })
  .strict()
  .partial();

export const ArivieConfigSchema = z
  .object({
    owner: ownerSchema,
    model: z.custom<LanguageModel>((v) => v != null && typeof v === "object"),
    semantic: semanticSchema,
    sources: sourcesSchema,
    resolveUser: z.custom<ResolveUser>((v) => typeof v === "function"),
    workspace: workspaceSchema,
    skills: z.union([z.string(), z.array(z.string())]).optional(),
    skillsMode: z.enum(["eager", "on-demand", "auto"]).default("auto"),
    compileMetric: z.boolean().optional(),
    hooks: lifecycleHooksSchema.optional(),
    limits: limitSchema.optional(),
  })
  .strict();
