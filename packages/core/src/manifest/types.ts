/* SPDX-License-Identifier: Apache-2.0 */
import type { Tool } from "@mastra/core/tools";
import type { ContextSchemaDefinition } from "@arivie/context";
import type { CapabilityDefinition } from "../capabilities/types.js";
import type { ChannelDefinition } from "../triggers/channel.js";
import type { TriggerEvent } from "../triggers/types.js";
import type { ArivieSchedule } from "../schedules.js";
import type {
  BlueprintDefinition,
  DiagnosticResult,
  EvalPackDefinition,
  PluginPermission,
  RouteDefinition,
} from "../plugins/types.js";

/** A value contributed by a specific plugin, tagged with its owner. */
export interface OwnedRef<T> {
  pluginId: string;
  value: T;
}

/** Static, setup-free description of one plugin in the manifest. */
export interface ManifestPluginEntry {
  id: string;
  version: string;
  permissions: PluginPermission[];
  capabilities: CapabilityDefinition[];
  contextSchemas: ContextSchemaDefinition[];
  blueprints: BlueprintDefinition[];
}

/**
 * The compiled runtime manifest (RFC §6.1, §7.3). Static surfaces
 * (plugins/capabilities/contextSchemas/blueprints/permissions) are always
 * present; runtime surfaces (tools/channels/routes/schedules/evals) are
 * populated only when plugin `setup()` is run — `arivie info` can describe the
 * static graph without it (RFC §12 Q4). `hasRuntime` records which it is.
 */
export interface RuntimeManifest {
  app: { id: string; name: string };
  plugins: ManifestPluginEntry[];
  /** permission id → plugin ids that declared it. */
  permissions: Map<string, string[]>;
  capabilities: Map<string, OwnedRef<CapabilityDefinition>>;
  contextSchemas: Map<string, OwnedRef<ContextSchemaDefinition>>;
  blueprints: Map<string, OwnedRef<BlueprintDefinition>>;
  tools: Map<string, OwnedRef<Tool>>;
  channels: Map<string, OwnedRef<ChannelDefinition<unknown, TriggerEvent>>>;
  /** Route key is `${METHOD} ${path}`. */
  routes: Map<string, OwnedRef<RouteDefinition>>;
  schedules: OwnedRef<ArivieSchedule>[];
  evals: OwnedRef<EvalPackDefinition>[];
  /** System-prompt fragments contributed by plugins, tagged by owner. */
  instructions: OwnedRef<string>[];
  diagnostics: DiagnosticResult[];
  hasRuntime: boolean;
}

export interface BuildManifestResult {
  manifest: RuntimeManifest;
  diagnostics: DiagnosticResult[];
}
