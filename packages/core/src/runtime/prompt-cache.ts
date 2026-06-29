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
 * @deprecated Pass `wrapInstructionsForCache` to the agent constructor instead.
 * Call-level `providerOptions.anthropic.cacheControl` lands on the top-level
 * Anthropic API request body, not on the system message content block.
 */
export function governanceCoreCacheProviderOptions(
  model: unknown,
): GovernanceCoreCacheProviderOptions | undefined {
  if (!isAnthropicModel(model)) return undefined;
  return { anthropic: { cacheControl: { type: "ephemeral" } } };
}

/** Structural shape accepted by Mastra's SystemMessage union as a CoreSystemMessage. */
type AnthropicCachedSystemMessage = {
  role: "system";
  content: string;
  experimental_providerMetadata: { anthropic: { cacheControl: { type: "ephemeral" } } };
};

/**
 * Wrap a system-prompt string so that Anthropic prompt caching lands on the
 * **system message content block** — not the top-level request body.
 *
 * For Anthropic models, returns a CoreSystemMessage carrying
 * `experimental_providerMetadata.anthropic.cacheControl`. Mastra's message
 * pipeline preserves this through `fromCoreMessage` → `toUIMessage` →
 * `aiV5UIMessagesToAIV5ModelMessages`, which promotes `metadata.providerMetadata`
 * to `providerOptions` on the final model message; the Anthropic SDK then writes
 * it as `cache_control` on the system block element.
 *
 * For non-Anthropic models, returns the instructions string unchanged.
 */
export function wrapInstructionsForCache(
  instructions: string,
  model: unknown,
): string | AnthropicCachedSystemMessage {
  if (!isAnthropicModel(model)) return instructions;
  return {
    role: "system",
    content: instructions,
    experimental_providerMetadata: { anthropic: { cacheControl: { type: "ephemeral" } } },
  };
}