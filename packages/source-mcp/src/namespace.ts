/* SPDX-License-Identifier: Apache-2.0 */

/**
 * Namespaces a discovered MCP tool for multi-source registration.
 * If the tool already starts with `<sourceName>_`, keep as-is to avoid double-prefixing.
 */
export function namespaceToolName(sourceName: string, toolName: string): string {
  const prefix = `${sourceName}_`;
  if (toolName.startsWith(prefix)) {
    return toolName;
  }
  return `${prefix}${toolName}`;
}
