/* SPDX-License-Identifier: Apache-2.0 */
import type { StandardSchemaV1 } from "@standard-schema/spec";

/**
 * A named unit of functionality a plugin exposes to agents, tools, context,
 * channels, SDKs, and diagnostics (RFC §4.3). Capabilities are declared
 * statically so the runtime manifest — and `arivie info` — can describe what
 * an app can do without running plugin setup.
 *
 * Agents opt into capabilities by id (e.g. `capabilities: ["analytics.query"]`).
 * A capability is invalid if it references an undeclared plugin permission;
 * that check runs in `definePlugin` (C1) and again at manifest build (C2).
 */
export interface CapabilityDefinition {
  /** Unique capability id within the app, e.g. `analytics.query`. */
  id: string;
  /** Short human title for menus and diagnostics. */
  title: string;
  /** One sentence the agent prompt builder can surface. */
  description: string;
  /** Standard Schema for capability input, when invoked as a capability target. */
  inputSchema?: StandardSchemaV1<unknown>;
  /** Standard Schema for capability output. */
  outputSchema?: StandardSchemaV1<unknown>;
  /** Permission ids (declared by the owning plugin) this capability requires. */
  requiredPermissions?: string[];
  /** Context schema ids this capability reads. */
  contextRefs?: string[];
  /** Tool names this capability is implemented by. */
  toolRefs?: string[];
  /** Route paths this capability is served by. */
  routeRefs?: string[];
}
