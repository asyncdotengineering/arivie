/* SPDX-License-Identifier: Apache-2.0 */
export { ArivieConfigSchema } from "./config.js";
export {
  ArivieBoundaryError,
  ArivieConfigError,
  ArivieInternalError,
  ArivieNotImplementedError,
} from "./errors.js";
export { defineArivie } from "./define.js";
export { localWorkspace } from "./local-workspace.js";
export type { LocalWorkspaceOptions } from "./local-workspace.js";
export { mcpSource } from "./sources-factory.js";
// Convenience re-exports — author entities in TS without a second import.
export { composeSemantic, defineEntity } from "@arivie/semantic";
export type { ComposeSemanticOptions, Entity } from "@arivie/semantic";
export {
  getCurrentUserContext,
  runWithUserContext,
  setCurrentUserContext,
} from "./context.js";
export { verifyOwnerIdentity } from "./verify.js";
export type {
  AfterQueryCtx,
  ArivieConfig,
  ArivieInstance,
  AskOptions,
  AskResult,
  BeforeQueryCtx,
  CompileMetricToolEvent,
  EmbeddingsConfig,
  ErrorCtx,
  ExecutePostgresToolEvent,
  ExecuteSourceToolEvent,
  ExportedHandler,
  FinalizeReportToolEvent,
  LifecycleHooks,
  LimitConfig,
  MCPServerConfig,
  MemoryDeleteCtx,
  MemorySaveCtx,
  ResolveUser,
  SemanticConfig,
  SourceAdapter,
  SourceAdapterCompileMetricOpts,
  SourceAdapterCompileMetricResult,
  SourceAdapterExecuteOpts,
  SourceAdapterExecuteResult,
  SourceConfigEntry,
  SourcesConfig,
  ToolCallEvent,
  ToolCallTrace,
  UnknownToolEvent,
  UserContext,
  WorkspaceBashToolEvent,
  WorkspaceConfig,
  WorkspaceDeleteToolEvent,
  WorkspaceEditFileToolEvent,
  WorkspaceFileStatToolEvent,
  WorkspaceGrepToolEvent,
  WorkspaceListFilesToolEvent,
  WorkspaceMkdirToolEvent,
  WorkspaceReadFileToolEvent,
  WorkspaceWriteFileToolEvent,
} from "./types.js";
