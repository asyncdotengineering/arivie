/* SPDX-License-Identifier: Apache-2.0 */
import type { LifecycleHooks, LimitConfig, SourceAdapter } from "@arivie/core/types";
import type { SemanticLayer } from "@arivie/semantic";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { dispatchCompileMetric } from "./compile-metric-dispatch.js";
export type { CompileMetricArgs } from "./compile-metric-dispatch.js";

export interface CompileMetricForOptions {
  readonly semantic: SemanticLayer;
  readonly sources: Record<string, SourceAdapter<unknown>>;
  readonly ownerId: string;
  readonly limits: LimitConfig;
  readonly hooks?: LifecycleHooks;
}

export function compileMetricFor({
  semantic,
  sources,
  ownerId,
  limits,
  hooks,
}: CompileMetricForOptions) {
  return createTool({
    id: "compile_metric",
    description:
      "Compile a named metric from the semantic layer, dispatch to the entity's source adapter, execute, and return rows. Cross-source client-side joins run per-side queries then hash-join in-process.",
    inputSchema: z.object({
      metric: z.string().min(1),
      dimensions: z.array(z.string()).optional(),
      filters: z.record(z.string(), z.unknown()).optional(),
      segments: z.array(z.string()).optional(),
      entityHint: z.string().optional(),
    }),
    execute: async (args) =>
      dispatchCompileMetric(
        {
          semantic,
          sources,
          ownerId,
          limits,
          ...(hooks !== undefined ? { hooks } : {}),
        },
        args,
      ),
  });
}
