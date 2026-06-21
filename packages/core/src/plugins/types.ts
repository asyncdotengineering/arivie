/* SPDX-License-Identifier: Apache-2.0 */
import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { Tool } from "@mastra/core/tools";
import type { ContextSchemaDefinition } from "@arivie/context";
import type { CapabilityDefinition } from "../capabilities/types.js";
import type { ChannelDefinition } from "../triggers/channel.js";
import type { TriggerEvent, TriggerMethod } from "../triggers/types.js";
import type { ArivieSchedule } from "../schedules.js";

/**
 * Well-known dangerous permission ids (RFC §10.1). A plugin MUST declare a
 * permission before any tool, route, ingestion hook, or dispatch target uses
 * the corresponding capability; the runtime enforces this at startup (C7).
 * Plugins may also declare domain permissions (e.g. `analytics.sql.read`).
 */
export const DANGEROUS_PERMISSIONS = [
  "network.outbound",
  "filesystem.read",
  "filesystem.write",
  "shell.execute",
  "database.read",
  "database.write",
  "secrets.read",
  "webhook.receive",
  "webhook.send",
  "model.invoke",
] as const;

export type DangerousPermission = (typeof DANGEROUS_PERMISSIONS)[number];

/** A permission a plugin declares before using the matching capability. */
export interface PluginPermission {
  /** Permission id — a {@link DangerousPermission} or a domain id. */
  id: string;
  /** Why the plugin needs it; surfaced in `arivie info` and review. */
  description: string;
}

/**
 * A versioned, AI-consumable Markdown implementation guide owned by a plugin
 * (RFC §4.10). Blueprints are installed into the repo by the CLI and reviewed
 * like code; they do NOT imply runtime code loading. The install/read CLI and
 * marker reconciliation are built in C14 — this is the declaration contract.
 */
export interface BlueprintMarker {
  /** Unique marker id within the blueprint. */
  id: string;
  /** Human description of what the marker anchors. */
  description?: string;
}

export interface BlueprintFile {
  /** Repo-relative destination path. */
  path: string;
  /** File contents (Markdown or code). */
  contents: string;
}

export interface BlueprintDefinition {
  id: string;
  title: string;
  version: string;
  /** Plugin/capability ids this blueprint applies to. */
  appliesTo: string[];
  files: BlueprintFile[];
  markers?: BlueprintMarker[];
}

/** A single diagnostic finding (manifest validation, plugin self-check). */
export interface DiagnosticResult {
  id: string;
  severity: "error" | "warning" | "info";
  message: string;
  detail?: Record<string, unknown>;
}

/** Minimal eval pack declaration; eval cases are wired through C16. */
export interface EvalPackDefinition {
  id: string;
  description?: string;
  cases?: unknown[];
}

/** A plugin-contributed HTTP route mounted on the Hono server (C8). */
export interface RouteDefinition {
  method: TriggerMethod;
  path: string;
  // biome-ignore lint/suspicious/noExplicitAny: Hono Context shape varies by
  // generics; the server (C8) narrows it at mount time.
  handler: (c: any) => Response | Promise<Response>;
}

/**
 * Context handed to a plugin's `setup()` hook. Setup runs at app build time
 * (NOT during `arivie info` static discovery — RFC §12 Q4). It may use only
 * the permissions the plugin declared; the runtime asserts that at startup.
 */
export interface PluginSetupContext<TConfig = unknown> {
  /** Validated plugin config (parsed by `configSchema` when present). */
  config: TConfig;
  /** Owning app identity. */
  app: { id: string; name: string };
  /** Permission ids the plugin declared, for setup-time capability checks. */
  permissions: ReadonlySet<string>;
}

/**
 * The runtime surface a plugin contributes when its `setup()` runs. Kept
 * separate from the static {@link PluginDefinition} metadata so the manifest
 * (and `arivie info`) can describe capabilities/permissions/context schemas
 * without executing setup.
 */
export interface PluginRuntimeContribution {
  /** Mastra tools keyed by tool name. We build on Mastra's tool surface. */
  tools?: Record<string, Tool>;
  /**
   * A system-prompt fragment contributed to any agent that uses one of this
   * plugin's capabilities. The agent builder (defineArivie) concatenates the
   * agent's own instructions with the fragments of the plugins backing its
   * declared capabilities (e.g. the analytics plugin contributes its
   * semantic-layer-aware prompt).
   */
  instructions?: string;
  /** Inbound channels (reuse the existing trigger/channel contract). */
  channels?: ChannelDefinition<unknown, TriggerEvent>[];
  /** Recurring schedules contributed by the plugin. */
  schedules?: ArivieSchedule[];
  /** HTTP routes mounted under the plugin's namespace. */
  routes?: RouteDefinition[];
  /** Diagnostics computed during setup. */
  diagnostics?: DiagnosticResult[];
  /** Eval packs exercised through public surfaces (C16). */
  evals?: EvalPackDefinition[];
}

/**
 * The static + lifecycle definition of a plugin (RFC §4.2). Static metadata
 * (id, version, permissions, capabilities, contextSchemas, blueprints) is
 * declared up front; runtime tools/channels/routes/diagnostics/evals are
 * returned from {@link PluginDefinition.setup}.
 */
export interface PluginDefinition<TConfig = unknown> {
  /** Stable plugin id, lowercase slug (e.g. `analytics`). */
  id: string;
  /** Semver version of the plugin. */
  version: string;
  /** Standard Schema validating the plugin's config at instantiation. */
  configSchema?: StandardSchemaV1<TConfig>;
  /** Permissions the plugin requires (RFC §10.1, REQ-11). */
  permissions?: PluginPermission[];
  /** Capabilities the plugin exposes to agents. */
  capabilities?: CapabilityDefinition[];
  /** Context schemas the plugin registers (RFC §4.4, REQ-5). */
  contextSchemas?: ContextSchemaDefinition[];
  /** Versioned Markdown blueprints (RFC §4.10). */
  blueprints?: BlueprintDefinition[];
  /** Lifecycle hook returning the runtime contribution. Runs at app build. */
  setup?(
    ctx: PluginSetupContext<TConfig>,
  ): PluginRuntimeContribution | Promise<PluginRuntimeContribution>;
}

/** A plugin definition bound to its config — what `defineArivie` consumes. */
export interface PluginInstance<TConfig = unknown> {
  definition: PluginDefinition<TConfig>;
  config: TConfig;
}

/**
 * A versioned plugin factory. Calling it with config returns a
 * {@link PluginInstance} (RFC §4.2). `definePlugin` returns this.
 */
export type PluginFactory<TConfig = unknown> = (
  config: TConfig,
) => PluginInstance<TConfig>;
