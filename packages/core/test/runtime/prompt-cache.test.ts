/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import {
  governanceCoreCacheProviderOptions,
  isAnthropicModel,
  wrapInstructionsForCache,
} from "../../src/runtime/prompt-cache.js";

describe("governanceCoreCacheProviderOptions", () => {
  it("sets Anthropic ephemeral cacheControl on the governance core", () => {
    const model = new MockLanguageModelV3({
      provider: "anthropic",
      modelId: "claude-sonnet-4-20250514",
    });
    expect(isAnthropicModel(model)).toBe(true);
    expect(governanceCoreCacheProviderOptions(model)).toEqual({
      anthropic: { cacheControl: { type: "ephemeral" } },
    });
  });

  it("no-ops for non-Anthropic models", () => {
    const model = new MockLanguageModelV3({ provider: "mock", modelId: "mock" });
    expect(isAnthropicModel(model)).toBe(false);
    expect(governanceCoreCacheProviderOptions(model)).toBeUndefined();
  });
});

describe("wrapInstructionsForCache", () => {
  it("returns a CoreSystemMessage with experimental_providerMetadata for Anthropic models", () => {
    const model = new MockLanguageModelV3({
      provider: "anthropic",
      modelId: "claude-sonnet-4-20250514",
    });
    const result = wrapInstructionsForCache("You are an analyst.", model);
    expect(result).toEqual({
      role: "system",
      content: "You are an analyst.",
      experimental_providerMetadata: { anthropic: { cacheControl: { type: "ephemeral" } } },
    });
  });

  it("returns the string unchanged for non-Anthropic models", () => {
    const model = new MockLanguageModelV3({ provider: "mock", modelId: "mock" });
    const result = wrapInstructionsForCache("You are an analyst.", model);
    expect(result).toBe("You are an analyst.");
  });
});