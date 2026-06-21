/* SPDX-License-Identifier: Apache-2.0 */
export {
  ArivieBoundaryError,
  ArivieConfigError,
  ArivieInternalError,
  ArivieNotImplementedError,
} from "./errors.js";
export { defineArivie } from "./define-app.js";
export type { ArivieApp, ArivieAppConfig, PromptInput } from "./define-app.js";
export { listConversations } from "./runtime/conversations.js";
export type { ConversationSummary } from "./runtime/conversations.js";
export {
  assertUniquePluginIds,
  DANGEROUS_PERMISSIONS,
  definePlugin,
  parsePluginConfig,
  validatePluginDefinition,
  validateStandardSchema,
} from "./plugins/index.js";
export type {
  BlueprintDefinition,
  BlueprintFile,
  BlueprintMarker,
  DangerousPermission,
  DiagnosticResult,
  EvalPackDefinition,
  PluginDefinition,
  PluginFactory,
  PluginInstance,
  PluginPermission,
  PluginRuntimeContribution,
  PluginSetupContext,
  RouteDefinition,
} from "./plugins/index.js";
export type { CapabilityDefinition } from "./capabilities/types.js";
export {
  ArivieEventSchema,
  compareCursors,
  CURSOR_WIDTH,
  decodeNDJSON,
  encodeNDJSON,
  encodeSSE,
  formatCursor,
  isArivieEvent,
  parseEvent,
} from "./events/index.js";
export type {
  ApprovalRequestedEvent,
  ArivieEvent,
  ArivieEventType,
  ArtifactWrittenEvent,
  BaseEvent,
  ChannelEventReceivedEvent,
  EventRedactor,
  ModelDeltaEvent,
  RunCompletedEvent,
  RunFailedEvent,
  RunStartedEvent,
  SessionStartedEvent,
  ToolCallCompletedEvent,
  ToolCallStartedEvent,
} from "./events/index.js";
export {
  assertManifestValid,
  buildManifest,
  hasFatalDiagnostics,
} from "./manifest/index.js";
export {
  installBlueprint,
  isBlueprintInstalled,
  readInstalledBlueprints,
} from "./blueprints/index.js";
export type {
  InstallBlueprintOptions,
  InstallBlueprintResult,
  InstalledBlueprintRecord,
} from "./blueprints/index.js";
export {
  assertStorageContract,
  InMemoryRuntimeStorage,
} from "./storage/index.js";
export {
  assembleAgentContext,
  createRuntime,
  decodeContinuation,
  defineAgent,
  encodeContinuation,
  executeRun,
  streamEvents,
} from "./runtime/index.js";
export type {
  AgentDefinition,
  AgentExecutor,
  AgentTurnResult,
  AssembledAgentContext,
  CreateRuntimeOptions,
  CreateSessionInput,
  ResolvedAgent,
  RunContext,
  Runtime,
  SessionHandle,
} from "./runtime/index.js";
export {
  admitChannelEvent,
  createDispatchWorker,
  dispatchDedupeKey,
  DispatchRetryableError,
} from "./dispatch/index.js";
export type {
  DispatchableEvent,
  DispatchTickResult,
  DispatchWorker,
  DispatchWorkerOptions,
} from "./dispatch/index.js";
export type {
  AcquireLeaseInput,
  AdmitDispatchInput,
  AdmitDispatchResult,
  ClaimReadyInput,
  ContextIndexRecord,
  ContextIndexStore,
  CreateRunInput,
  CreateSessionRecordInput,
  DispatchMessage,
  DispatchQueueStore,
  DispatchStatus,
  EventInput,
  EventStore,
  Lease,
  LeaseStore,
  RetryLaterInput,
  RunError,
  RunRecord,
  RunStatus,
  RunStore,
  RuntimeStorage,
  SessionRecord,
  SessionStore,
  StorageFactory,
} from "./storage/index.js";
export type {
  BuildManifestInput,
  BuildManifestResult,
  ManifestPluginEntry,
  OwnedRef,
  RuntimeManifest,
} from "./manifest/index.js";
export { defineSchedule, defineSchedules } from "./schedules.js";
export type { ArivieSchedule } from "./schedules.js";
export { createSqlSemanticScorer, extractExecuteSql, resultsEqual } from "./eval/index.js";
export type { SqlSemanticScorerOptions } from "./eval/index.js";
export { localWorkspace } from "./local-workspace.js";
export type { LocalWorkspaceOptions } from "./local-workspace.js";
export {
  getCurrentUserContext,
  runWithUserContext,
  setCurrentUserContext,
} from "./context.js";
export { verifyOwnerIdentity } from "./verify.js";
export { createSessionApp, mountSessionRoutes } from "./server/routes/index.js";
export type { SessionRoutesOptions } from "./server/routes/index.js";
export type {
  AfterQueryCtx,
  BeforeQueryCtx,
  CompileMetricToolEvent,
  ErrorCtx,
  ExecutePostgresToolEvent,
  ExecuteSourceToolEvent,
  FinalizeReportToolEvent,
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
  ToolCallEvent,
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
