/* SPDX-License-Identifier: Apache-2.0 */
import { validatePluginDefinition } from "../plugins/define.js";
import { parsePluginConfig } from "../plugins/registry.js";
import type {
  DiagnosticResult,
  PluginInstance,
  PluginRuntimeContribution,
} from "../plugins/types.js";
import type {
  BuildManifestResult,
  ManifestPluginEntry,
  RuntimeManifest,
} from "./types.js";
import { checkPermissionsDeclared, mergeUnique } from "./validate.js";

export interface BuildManifestInput {
  app: { id: string; name: string };
  plugins: readonly PluginInstance[];
  /**
   * Run each plugin's `setup()` and merge its runtime contribution
   * (tools/channels/routes/schedules/evals). Defaults to `true`. `arivie info`
   * passes `false` for a static-only graph (RFC §12 Q4).
   */
  runSetup?: boolean;
}

function emptyManifest(app: { id: string; name: string }): RuntimeManifest {
  return {
    app,
    plugins: [],
    permissions: new Map(),
    capabilities: new Map(),
    contextSchemas: new Map(),
    blueprints: new Map(),
    tools: new Map(),
    channels: new Map(),
    routes: new Map(),
    schedules: [],
    evals: [],
    instructions: [],
    workspaces: [],
    disposers: [],
    diagnostics: [],
    hasRuntime: false,
  };
}

function mergeStatic(
  manifest: RuntimeManifest,
  instance: PluginInstance,
  diagnostics: DiagnosticResult[],
): void {
  const def = instance.definition;
  const entry: ManifestPluginEntry = {
    id: def.id,
    version: def.version,
    permissions: def.permissions ?? [],
    capabilities: def.capabilities ?? [],
    contextSchemas: def.contextSchemas ?? [],
    blueprints: def.blueprints ?? [],
  };
  manifest.plugins.push(entry);

  for (const perm of entry.permissions) {
    const owners = manifest.permissions.get(perm.id) ?? [];
    owners.push(def.id);
    manifest.permissions.set(perm.id, owners);
  }
  for (const cap of entry.capabilities) {
    mergeUnique(manifest.capabilities, cap.id, def.id, cap, "capability", diagnostics);
  }
  for (const schema of entry.contextSchemas) {
    mergeUnique(
      manifest.contextSchemas,
      schema.id,
      def.id,
      schema,
      "context schema",
      diagnostics,
    );
  }
  for (const blueprint of entry.blueprints) {
    mergeUnique(
      manifest.blueprints,
      blueprint.id,
      def.id,
      blueprint,
      "blueprint",
      diagnostics,
    );
  }
}

function mergeContribution(
  manifest: RuntimeManifest,
  pluginId: string,
  contribution: PluginRuntimeContribution,
  diagnostics: DiagnosticResult[],
): void {
  for (const [name, tool] of Object.entries(contribution.tools ?? {})) {
    mergeUnique(manifest.tools, name, pluginId, tool, "tool", diagnostics);
  }
  for (const channel of contribution.channels ?? []) {
    mergeUnique(manifest.channels, channel.name, pluginId, channel, "channel", diagnostics);
  }
  for (const route of contribution.routes ?? []) {
    const key = `${route.method} ${route.path}`;
    mergeUnique(manifest.routes, key, pluginId, route, "route", diagnostics);
  }
  for (const schedule of contribution.schedules ?? []) {
    manifest.schedules.push({ pluginId, value: schedule });
  }
  for (const evalPack of contribution.evals ?? []) {
    manifest.evals.push({ pluginId, value: evalPack });
  }
  if (contribution.instructions !== undefined) {
    manifest.instructions.push({ pluginId, value: contribution.instructions });
  }
  if (contribution.workspace !== undefined) {
    manifest.workspaces.push({ pluginId, value: contribution.workspace });
  }
  if (contribution.dispose !== undefined) {
    manifest.disposers.push(contribution.dispose);
  }
  for (const diag of contribution.diagnostics ?? []) {
    diagnostics.push(diag);
  }
}

/**
 * Build the compiled runtime manifest from app config + plugin instances
 * (RFC §6.1, §7.3). Validates each plugin definition, asserts unique plugin
 * ids, merges static metadata, and — when `runSetup` (default) — runs each
 * plugin's `setup()` and merges the runtime contribution. Collisions and
 * undeclared permissions are recorded as fatal diagnostics rather than thrown;
 * callers decide (defineArivie throws via `assertManifestValid`; `arivie info`
 * prints them).
 */
export async function buildManifest(
  input: BuildManifestInput,
): Promise<BuildManifestResult> {
  const runSetup = input.runSetup ?? true;
  const manifest = emptyManifest(input.app);
  const diagnostics = manifest.diagnostics;

  const seenPluginIds = new Set<string>();
  for (const instance of input.plugins) {
    const def = instance.definition;
    validatePluginDefinition(def);
    if (seenPluginIds.has(def.id)) {
      diagnostics.push({
        id: `collision.plugin.${def.id}`,
        severity: "error",
        message: `Duplicate plugin id "${def.id}" in app config`,
        detail: { pluginId: def.id },
      });
      continue;
    }
    seenPluginIds.add(def.id);
    mergeStatic(manifest, instance, diagnostics);
  }

  checkPermissionsDeclared(manifest, diagnostics);

  if (runSetup) {
    manifest.hasRuntime = true;
    for (const instance of input.plugins) {
      const def = instance.definition;
      if (def.setup === undefined) continue;
      const parsed = await parsePluginConfig(instance);
      const contribution = await def.setup({
        config: parsed.config,
        app: input.app,
        permissions: new Set((def.permissions ?? []).map((p) => p.id)),
      });
      mergeContribution(manifest, def.id, contribution, diagnostics);
    }
  }

  return { manifest, diagnostics };
}
