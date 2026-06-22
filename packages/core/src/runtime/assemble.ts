/* SPDX-License-Identifier: Apache-2.0 */
import type { Tool } from "@mastra/core/tools";
import { ArivieConfigError } from "../errors.js";
import type { RuntimeManifest } from "../manifest/types.js";
import type { AgentDefinition } from "./types.js";

/** What an agent receives from the plugins backing its capabilities. */
export interface AssembledAgentContext {
  /** The agent's own instructions + the plugins' prompt fragments, joined. */
  instructions: string;
  /** Tools contributed by the plugins that own the agent's capabilities. */
  tools: Record<string, Tool>;
  /** The capability ids the agent declared (validated against the manifest). */
  capabilities: string[];
  /** The plugin ids backing those capabilities. */
  pluginIds: string[];
}

/**
 * Resolve a single agent's runtime context from the compiled manifest (the
 * core of multi-agent support, RFC §4.1). An agent declares capability ids;
 * each maps to its owning plugin, and the agent receives that plugin's
 * contributed tools and instruction fragment. This is the gate that keeps
 * agents scoped to the capabilities they opted into — not every plugin tool.
 *
 * Throws {@link ArivieConfigError} if the agent references a capability no
 * plugin provides (a config error worth failing fast on).
 */
export function assembleAgentContext(
  agentId: string,
  agent: AgentDefinition,
  manifest: RuntimeManifest,
  /**
   * Bodies of `usage_mode: always` knowledge pages from the context layer,
   * injected into every agent's instructions (ADR 0003). Procedural `skills`
   * stay out of here — this is the declarative knowledge pillar.
   */
  alwaysKnowledge: string[] = [],
): AssembledAgentContext {
  const capabilityIds = agent.capabilities ?? [];
  const pluginIds = new Set<string>();
  for (const capabilityId of capabilityIds) {
    const capability = manifest.capabilities.get(capabilityId);
    if (capability === undefined) {
      throw new ArivieConfigError(
        `Agent "${agentId}" references unknown capability "${capabilityId}"`,
      );
    }
    pluginIds.add(capability.pluginId);
  }

  const tools: Record<string, Tool> = {};
  for (const [name, ref] of manifest.tools) {
    if (pluginIds.has(ref.pluginId)) {
      tools[name] = ref.value;
    }
  }

  const fragments = manifest.instructions
    .filter((ref) => pluginIds.has(ref.pluginId))
    .map((ref) => ref.value);

  const instructions = [agent.instructions, ...fragments, ...alwaysKnowledge]
    .filter((part) => part.length > 0)
    .join("\n\n");

  return {
    instructions,
    tools,
    capabilities: capabilityIds,
    pluginIds: [...pluginIds],
  };
}
