/* SPDX-License-Identifier: Apache-2.0 */

export type GovernanceCoreCacheProviderOptions = {
  anthropic: { cacheControl: { type: "ephemeral" } };
};

/** True when the language model is an Anthropic provider (AI SDK `provider` id). */
export function isAnthropicModel(model: unknown): boolean {
  return (
    model !== null &&
    typeof model === "object" &&
    "provider" in model &&
    (model as { provider: string }).provider === "anthropic"
  );
}

/**
 * Anthropic prompt-cache breakpoint on the stable governance-core system prefix.
 * Non-Anthropic models: undefined (no-op at call site).
 */
export function governanceCoreCacheProviderOptions(
  model: unknown,
): GovernanceCoreCacheProviderOptions | undefined {
  if (!isAnthropicModel(model)) return undefined;
  return { anthropic: { cacheControl: { type: "ephemeral" } } };
}