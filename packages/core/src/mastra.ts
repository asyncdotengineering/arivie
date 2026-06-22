/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Mastra, un-shadowed.
 *
 * Arivie wraps Mastra (ADR 0002) — but we don't HIDE it. This module re-exports
 * Mastra's primitives under stable namespaces so app authors can reach them
 * directly through `@arivie/core/mastra`, using the exact Mastra version Arivie
 * resolves (no dual-package hazard, no opinionated shadow API):
 *
 * ```ts
 * import { agent, tools, processors, workflows, llm } from "@arivie/core/mastra";
 *
 * const t = tools.createTool({ ... });
 * const guard = new processors.PromptInjectionDetector({ ... });
 * const wf = workflows.createWorkflow({ ... });
 * ```
 *
 * Everything Mastra exports on each subpath is exposed here — nothing is
 * curated away. Prefer these when you want a Mastra primitive Arivie doesn't
 * wrap; reach for Arivie's own surface (`defineArivie`, `definePlugin`, …) when
 * you want the durable/plugin runtime on top.
 */
export * as agent from "@mastra/core/agent";
export * as tools from "@mastra/core/tools";
export * as processors from "@mastra/core/processors";
export * as workspace from "@mastra/core/workspace";
export * as workflows from "@mastra/core/workflows";
export * as llm from "@mastra/core/llm";
export * as requestContext from "@mastra/core/request-context";
export * as vector from "@mastra/core/vector";
