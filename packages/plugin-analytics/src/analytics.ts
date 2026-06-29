/* SPDX-License-Identifier: Apache-2.0 */
import { existsSync } from "node:fs";
import { buildSystemPrompt } from "@arivie/agent";
import {
  definePlugin,
  type CapabilityDefinition,
  type PluginFactory,
  type SourceAdapter,
} from "@arivie/core";
import {
  LoadError,
  loadSemanticLayerSync,
  ParseError,
  type SemanticLayer,
} from "@arivie/semantic";
import { analyticsEntityContextSchema } from "./semantic-schema.js";
import { buildAnalyticsTools } from "./tools.js";

export interface AnalyticsPluginConfig {
  /** Directory of semantic entity YAML (loaded via loadSemanticLayerSync). */
  semanticPath: string;
  /** Named analytical sources. postgresSource(...) returns a SourceAdapter. */
  sources: Record<string, SourceAdapter<unknown>>;
  /** Register the compile_metric tool. Default false. */
  compileMetric?: boolean;
  /** Owner id for query audit / hooks. Defaults to "analytics". */
  ownerId?: string;
}

const ANALYTICS_QUERY_CAPABILITY: CapabilityDefinition = {
  id: "analytics.query",
  title: "Query analytics sources",
  description:
    "Answer analytical questions with semantic-layer context and approved read-only source tools.",
  requiredPermissions: ["analytics.sql.read"],
  contextRefs: ["analytics.entity"],
};

const ANALYTICS_COMPILE_METRIC_CAPABILITY: CapabilityDefinition = {
  id: "analytics.compile_metric",
  title: "Compile semantic metrics",
  description:
    "Compile declared semantic-layer metrics into source queries and execute them.",
  requiredPermissions: ["analytics.sql.read", "database.read"],
  contextRefs: ["analytics.entity"],
  toolRefs: ["compile_metric"],
};

function emptySemanticLayer(): SemanticLayer {
  return {
    entities: new Map(),
    catalog: {
      entities: [],
      generated_at: new Date().toISOString(),
      source_files: [],
    },
  };
}

function isEnoent(err: unknown): boolean {
  return (
    err instanceof Error &&
    "code" in err &&
    (err as { code: string }).code === "ENOENT"
  );
}

function loadSemanticLayerAtSetup(rootDir: string): SemanticLayer {
  if (!existsSync(rootDir)) {
    console.warn(
      `[arivie] semantic layer dir not found at ${rootDir}; using empty layer`,
    );
    return emptySemanticLayer();
  }

  try {
    return loadSemanticLayerSync(rootDir);
  } catch (err: unknown) {
    if (err instanceof ParseError || err instanceof LoadError) {
      throw err;
    }
    if (isEnoent(err)) {
      console.warn(
        `[arivie] semantic layer dir not found at ${rootDir}; using empty layer`,
      );
      return emptySemanticLayer();
    }
    throw err;
  }
}

function capabilitiesFor(config: AnalyticsPluginConfig): CapabilityDefinition[] {
  return config.compileMetric === true
    ? [ANALYTICS_QUERY_CAPABILITY, ANALYTICS_COMPILE_METRIC_CAPABILITY]
    : [ANALYTICS_QUERY_CAPABILITY];
}

export const analytics: PluginFactory<AnalyticsPluginConfig> = (config) =>
  definePlugin<AnalyticsPluginConfig>({
    id: "analytics",
    version: "1.0.0",
    permissions: [
      {
        id: "analytics.sql.read",
        description: "Execute read-only analytical SQL",
      },
      {
        id: "database.read",
        description: "Read analytical sources",
      },
    ],
    capabilities: capabilitiesFor(config),
    contextSchemas: [analyticsEntityContextSchema],
    setup(ctx) {
      const semantic = loadSemanticLayerAtSetup(ctx.config.semanticPath);
      const compileMetric = ctx.config.compileMetric === true;
      const ownerId = ctx.config.ownerId ?? "analytics";
      const sourceDescriptors = Object.entries(ctx.config.sources).map(
        ([name, source]) => ({
          name,
          description: `Analytical ${source.kind} source "${name}" (${source.id}).`,
        }),
      );

      return {
        tools: buildAnalyticsTools({
          semantic,
          sources: ctx.config.sources,
          ownerId,
          compileMetric,
        }),
        instructions: buildSystemPrompt({
          semantic,
          compileMetricEnabled: compileMetric,
          sources: sourceDescriptors,
          hasFinalizeReport: false,
          skillsMode: "none",
        }),
        // Close source connection pools when the app is disposed.
        dispose: async () => {
          for (const source of Object.values(ctx.config.sources)) {
            await source.close?.();
          }
        },
      };
    },
  })(config);
