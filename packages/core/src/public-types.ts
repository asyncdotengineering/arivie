/* SPDX-License-Identifier: Apache-2.0 */

// ArivieBoundaryError lives here (the shared cycle-broken subpath) so
// db-postgres can throw it without forming `core → db-postgres → core` at
// the type-DTS layer. errors.ts re-exports for convenience.
export { ArivieBoundaryError } from "./errors.js";

export type {
  AfterQueryCtx,
  BeforeQueryCtx,
  ErrorCtx,
  LifecycleHooks,
  LimitConfig,
  MemoryDeleteCtx,
  MemorySaveCtx,
  ResolveUser,
  SourceAdapter,
  SourceAdapterCompileMetricOpts,
  SourceAdapterCompileMetricResult,
  SourceAdapterExecuteOpts,
  SourceAdapterExecuteResult,
  ToolApprovalPolicy,
  WorkspaceConfig,
  ToolCallEvent,
  ToolCallTrace,
  UserContext,
} from "./types.js";
