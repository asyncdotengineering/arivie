/* SPDX-License-Identifier: Apache-2.0 */
import { ArivieConfigError } from "../errors.js";
import type { DiagnosticResult } from "../plugins/types.js";
import type { OwnedRef, RuntimeManifest } from "./types.js";

/**
 * Insert `value` under `key`, recording a fatal collision diagnostic when a
 * different plugin already owns the key. The first owner wins so downstream
 * lookups stay deterministic; the diagnostic names both offenders.
 */
export function mergeUnique<T>(
  map: Map<string, OwnedRef<T>>,
  key: string,
  pluginId: string,
  value: T,
  kind: string,
  diagnostics: DiagnosticResult[],
): void {
  const existing = map.get(key);
  if (existing !== undefined) {
    diagnostics.push({
      id: `collision.${kind}.${key}`,
      severity: "error",
      message: `Duplicate ${kind} "${key}" contributed by plugins "${existing.pluginId}" and "${pluginId}"`,
      detail: { kind, key, plugins: [existing.pluginId, pluginId] },
    });
    return;
  }
  map.set(key, { pluginId, value });
}

/**
 * Cross-check capability `requiredPermissions` against the owning plugin's
 * declared permissions (RFC §6.1 assert_permissions_declared). definePlugin
 * checks this per plugin; the manifest re-checks after merge so an app-level
 * view is self-consistent.
 */
export function checkPermissionsDeclared(
  manifest: RuntimeManifest,
  diagnostics: DiagnosticResult[],
): void {
  for (const plugin of manifest.plugins) {
    const declared = new Set(plugin.permissions.map((p) => p.id));
    for (const cap of plugin.capabilities) {
      for (const required of cap.requiredPermissions ?? []) {
        if (!declared.has(required)) {
          diagnostics.push({
            id: `permission.undeclared.${plugin.id}.${cap.id}.${required}`,
            severity: "error",
            message: `Plugin "${plugin.id}" capability "${cap.id}" requires undeclared permission "${required}"`,
            detail: { pluginId: plugin.id, capabilityId: cap.id, permission: required },
          });
        }
      }
    }
  }
}

/** True if any diagnostic is fatal (severity `error`). */
export function hasFatalDiagnostics(diagnostics: readonly DiagnosticResult[]): boolean {
  return diagnostics.some((d) => d.severity === "error");
}

/**
 * Throw {@link ArivieConfigError} when the manifest has fatal diagnostics,
 * surfacing every error message. Called by `defineArivie` (C7); `arivie info`
 * prints diagnostics instead of throwing.
 */
export function assertManifestValid(diagnostics: readonly DiagnosticResult[]): void {
  const fatal = diagnostics.filter((d) => d.severity === "error");
  if (fatal.length === 0) return;
  throw new ArivieConfigError(
    `Invalid app manifest:\n${fatal.map((d) => `  - ${d.message}`).join("\n")}`,
  );
}
