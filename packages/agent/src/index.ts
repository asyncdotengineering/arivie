/* SPDX-License-Identifier: Apache-2.0 */
export { makeAgent } from "./make-agent.js";
export type { MakeAgentOptions } from "./make-agent.js";
export {
  assertToolShape,
  isMastraWorkspaceToolName,
  isNamespacedMcpToolName,
} from "./contract-invariants.js";
export type { AssertToolShapeOptions } from "./contract-invariants.js";
export { executeToolFor } from "./tools/execute.js";
export type { ExecuteToolForOptions } from "./tools/execute.js";
export {
  finalizeReportTool,
  finalizeReportStopWhen,
  shouldRegisterFinalizeReport,
} from "./tools/finalize-report.js";
export type {
  FinalizeReportInput,
  FinalizeReportResult,
} from "./tools/finalize-report.js";
export { compileMetricFor } from "./tools/compile-metric.js";
export type { CompileMetricForOptions } from "./tools/compile-metric.js";
export { dispatchCompileMetric, resolveMetric } from "./tools/compile-metric-dispatch.js";
export type {
  CompileMetricArgs,
  DispatchCompileMetricOptions,
} from "./tools/compile-metric-dispatch.js";
export {
  buildSystemPrompt,
  buildSystemPromptIndexed,
  temporalGrounding,
  WORKSPACE_NAVIGATION_RULE,
  ASSUMPTION_STATING_RULE,
  SELF_CORRECTION_RULES,
  SKILL_DISCIPLINE_EAGER,
  SKILL_DISCIPLINE_ONDEMAND,
} from "./prompt.js";
export type {
  BuildSystemPromptIndexedOptions,
  BuildSystemPromptOptions,
  ContextMode,
  SkillsMode,
} from "./prompt.js";
export { autoDetectMode } from "./auto-detect.js";
export { crossSourceHashJoin } from "./cross-source.js";
export type {
  CrossSourceHashJoinOptions,
  CrossSourceHashJoinResult,
} from "./cross-source.js";
