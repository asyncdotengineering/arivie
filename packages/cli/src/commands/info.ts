/* SPDX-License-Identifier: Apache-2.0 */
import type { RuntimeManifest } from "@arivie/core";
import { defineCommand } from "citty";
import { loadArivieInstance } from "../lib/load-instance.js";

/** JSON-serializable projection of the compiled manifest for `arivie info`. */
export interface ManifestInfo {
  app: { id: string; name: string };
  hasRuntime: boolean;
  plugins: Array<{
    id: string;
    version: string;
    permissions: string[];
    capabilities: string[];
    contextSchemas: string[];
    blueprints: string[];
  }>;
  capabilities: Array<{ id: string; plugin: string; title: string }>;
  contextSchemas: Array<{ id: string; plugin: string; kind: string }>;
  tools: string[];
  channels: string[];
  routes: string[];
  schedules: Array<{ plugin: string; id: string }>;
  permissions: string[];
  diagnostics: RuntimeManifest["diagnostics"];
}

/** Project the manifest's Maps into a stable, JSON-friendly shape. */
export function serializeManifest(m: RuntimeManifest): ManifestInfo {
  return {
    app: m.app,
    hasRuntime: m.hasRuntime,
    plugins: m.plugins.map((p) => ({
      id: p.id,
      version: p.version,
      permissions: p.permissions.map((x) => x.id),
      capabilities: p.capabilities.map((c) => c.id),
      contextSchemas: p.contextSchemas.map((s) => s.id),
      blueprints: p.blueprints.map((b) => b.id),
    })),
    capabilities: [...m.capabilities.entries()].map(([id, ref]) => ({
      id,
      plugin: ref.pluginId,
      title: ref.value.title,
    })),
    contextSchemas: [...m.contextSchemas.entries()].map(([id, ref]) => ({
      id,
      plugin: ref.pluginId,
      kind: ref.value.kind,
    })),
    tools: [...m.tools.keys()].sort(),
    channels: [...m.channels.keys()].sort(),
    routes: [...m.routes.keys()].sort(),
    schedules: m.schedules.map((s) => ({ plugin: s.pluginId, id: s.value.id })),
    permissions: [...m.permissions.keys()].sort(),
    diagnostics: m.diagnostics,
  };
}

/** Render a human-readable summary of the manifest. */
export function formatInfo(info: ManifestInfo): string {
  const lines: string[] = [];
  lines.push(`App:     ${info.app.name} (${info.app.id})`);
  lines.push(`Runtime: ${info.hasRuntime ? "yes" : "static only"}`);
  lines.push("");
  lines.push(`Plugins (${info.plugins.length}):`);
  for (const p of info.plugins) {
    lines.push(`  - ${p.id}@${p.version}  caps:[${p.capabilities.join(", ")}]  perms:[${p.permissions.join(", ")}]`);
  }
  lines.push("");
  lines.push(`Capabilities (${info.capabilities.length}):`);
  for (const c of info.capabilities) lines.push(`  - ${c.id}  (${c.plugin})  ${c.title}`);
  lines.push("");
  lines.push(`Context schemas (${info.contextSchemas.length}):`);
  for (const s of info.contextSchemas) lines.push(`  - ${s.id}  (${s.plugin}, ${s.kind})`);
  lines.push("");
  lines.push(`Tools:     ${info.tools.join(", ") || "(none)"}`);
  lines.push(`Channels:  ${info.channels.join(", ") || "(none)"}`);
  lines.push(`Schedules: ${info.schedules.map((s) => s.id).join(", ") || "(none)"}`);
  const errors = info.diagnostics.filter((d) => d.severity === "error");
  const warnings = info.diagnostics.filter((d) => d.severity === "warning");
  lines.push("");
  lines.push(`Diagnostics: ${errors.length} error(s), ${warnings.length} warning(s)`);
  for (const d of info.diagnostics) lines.push(`  [${d.severity}] ${d.message}`);
  return lines.join("\n");
}

export interface InfoOptions {
  json?: boolean;
  log?: (line: string) => void;
  errorLog?: (line: string) => void;
}

/**
 * `arivie info` — load the app, compile the manifest, and print the
 * plugin/capability/context graph + diagnostics (RFC §4.9, §7.6). Loading the
 * app constructs agents and runs plugin setup (filesystem only); it does NOT
 * invoke the model or open network connections (§12 Q4). Exit code is non-zero
 * on fatal diagnostics or a config that fails to load.
 */
export async function runInfo(configPath: string, options: InfoOptions = {}): Promise<number> {
  const log = options.log ?? ((line: string) => console.log(line));
  const errorLog = options.errorLog ?? ((line: string) => console.error(line));

  let app: Awaited<ReturnType<typeof loadArivieInstance>>;
  try {
    app = await loadArivieInstance(configPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (options.json) log(JSON.stringify({ error: message }, null, 2));
    else errorLog(`✗ Failed to load app: ${message}`);
    return 1;
  }

  const info = serializeManifest(app.manifest);
  if (options.json) log(JSON.stringify(info, null, 2));
  else log(formatInfo(info));

  const hasError = app.manifest.diagnostics.some((d) => d.severity === "error");
  await app.dispose?.();
  return hasError ? 1 : 0;
}

export const infoCommand = defineCommand({
  meta: {
    name: "info",
    description: "Inspect the compiled plugin/capability/context manifest and diagnostics",
  },
  args: {
    config: {
      type: "string",
      description: "Path to arivie.config.ts",
      default: "./arivie.config.ts",
    },
    json: {
      type: "boolean",
      description: "Emit the manifest + diagnostics as JSON",
      default: false,
    },
  },
  async run({ args }) {
    return runInfo(args.config as string, { json: Boolean(args.json) });
  },
});
