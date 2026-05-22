/* SPDX-License-Identifier: Apache-2.0 */
import type { Workspace } from "@mastra/core/workspace";
export interface AssertToolShapeConfig {
  compile_metric?: boolean;
  workspace: { finalizeReport?: boolean };
}

const MASTRA_WORKSPACE_TOOL_PREFIX = "mastra_workspace_";

export function isMastraWorkspaceToolName(name: string): boolean {
  return name.startsWith(MASTRA_WORKSPACE_TOOL_PREFIX);
}

/** Namespaced MCP tools (`<sourceName>_<toolName>`) are user-callable but outside REQ-53 count discipline. */
export function isNamespacedMcpToolName(
  name: string,
  sourceNames: readonly string[],
): boolean {
  for (const sourceName of sourceNames) {
    const prefix = `${sourceName}_`;
    if (name.startsWith(prefix) && name !== `execute_${sourceName}`) {
      return true;
    }
  }
  return false;
}

function isExcludedFromToolShapeDiscipline(
  name: string,
  sourceNames: readonly string[],
): boolean {
  return (
    isMastraWorkspaceToolName(name) ||
    isNamespacedMcpToolName(name, sourceNames)
  );
}

function filesystemKind(workspace: Workspace): string {
  const filesystem = workspace.filesystem;
  if (
    filesystem != null &&
    typeof filesystem === "object" &&
    "kind" in filesystem &&
    typeof filesystem.kind === "string"
  ) {
    return filesystem.kind;
  }
  return "local";
}

export interface AssertToolShapeOptions {
  tools: Record<string, unknown>;
  config: AssertToolShapeConfig;
  sourceNames: readonly string[];
  workspace: Workspace;
}

/**
 * Enforces REQ-53.a–d on the Arivie-native tool surface.
 *
 * REQ-53.d: Mastra auto-injected `mastra_workspace_*` tools are ignored.
 * Namespaced MCP tools (`<sourceName>_<toolName>` from `{ mcp }` sources) are
 * also ignored — REQ-53.a only requires `execute_<sourceName>` per source.
 */
export function assertToolShape(opts: AssertToolShapeOptions): void {
  const arivieToolNames = Object.keys(opts.tools).filter(
    (name) => !isExcludedFromToolShapeDiscipline(name, opts.sourceNames),
  );

  for (const sourceName of opts.sourceNames) {
    const expected = `execute_${sourceName}`;
    if (!arivieToolNames.includes(expected)) {
      throw new Error(
        `assertToolShape violation: REQ-53.a — missing tool ${expected}`,
      );
    }
  }

  const compileMetricEnabled = opts.config.compile_metric === true;
  const hasCompile = arivieToolNames.includes("compile_metric");
  if (compileMetricEnabled !== hasCompile) {
    throw new Error(
      `assertToolShape violation: REQ-53.b — compile_metric ${hasCompile ? "present" : "absent"} but config.compile_metric is ${compileMetricEnabled}`,
    );
  }

  const fsKind = filesystemKind(opts.workspace);
  const expectsFinalize =
    fsKind !== "local" && opts.config.workspace.finalizeReport !== false;
  const hasFinalize = arivieToolNames.includes("finalize_report");
  if (expectsFinalize !== hasFinalize) {
    throw new Error(
      `assertToolShape violation: REQ-53.c — finalize_report ${hasFinalize ? "present" : "absent"} for filesystem.kind=${fsKind}, finalizeReport=${String(opts.config.workspace.finalizeReport)}`,
    );
  }
}
