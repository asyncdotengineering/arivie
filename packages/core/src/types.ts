/* SPDX-License-Identifier: Apache-2.0 */
import type { WorkspaceFilesystem } from "@mastra/core/workspace";

export interface WorkspaceConfig {
  rootDir?: string;
  filesystem?: WorkspaceFilesystem;
  bash?: boolean;
  bm25?: boolean;
  finalizeReport?: boolean;
}

export type ResolveUser = (req: Request) => Promise<UserContext>;

export interface UserContext {
  userId: string;
  permissions: string[];
  dbRole: string;
  raw?: unknown;
  credentials?: Record<string, unknown>;
}

export interface LifecycleHooks {
  onBeforeQuery?: (ctx: BeforeQueryCtx) => Promise<void>;
  onAfterQuery?: (ctx: AfterQueryCtx) => Promise<void>;
  onToolCall?: (event: ToolCallEvent) => Promise<void>;
  onError?: (ctx: ErrorCtx) => Promise<void>;
  onMemorySave?: (ctx: MemorySaveCtx) => Promise<void>;
  onMemoryDelete?: (ctx: MemoryDeleteCtx) => Promise<void>;
}

export interface BeforeQueryCtx {
  question?: string;
  sql?: string;
  userId: string;
  ownerId: string;
  mode?: "auto" | "preload" | "indexed";
}

export interface AfterQueryCtx {
  sql: string;
  rows: Record<string, unknown>[];
  durationMs: number;
  cost?: number;
  userId: string;
  ownerId: string;
}

export type ToolCallEvent =
  | ExecutePostgresToolEvent
  | ExecuteSourceToolEvent
  | CompileMetricToolEvent
  | WorkspaceWriteFileToolEvent
  | WorkspaceReadFileToolEvent
  | WorkspaceGrepToolEvent
  | WorkspaceListFilesToolEvent
  | WorkspaceEditFileToolEvent
  | WorkspaceMkdirToolEvent
  | WorkspaceDeleteToolEvent
  | WorkspaceFileStatToolEvent
  | WorkspaceBashToolEvent
  | FinalizeReportToolEvent
  | UnknownToolEvent;

interface ToolEventBase {
  durationMs?: number;
  userId?: string;
  ownerId?: string;
}

export interface ExecutePostgresToolEvent extends ToolEventBase {
  tool: "execute_postgres";
  args: { sql: string };
}

export interface ExecuteSourceToolEvent extends ToolEventBase {
  tool: `execute_${string}`;
  args: Record<string, unknown>;
}

export interface CompileMetricToolEvent extends ToolEventBase {
  tool: "compile_metric";
  args: {
    metric: string;
    entityHint?: string;
    dimensions?: string[];
    filters?: Record<string, unknown>;
    segments?: string[];
  };
}

export interface WorkspaceWriteFileToolEvent extends ToolEventBase {
  tool: "mastra_workspace_write_file";
  args: { path: string; content: string; overwrite?: boolean };
}

export interface WorkspaceReadFileToolEvent extends ToolEventBase {
  tool: "mastra_workspace_read_file";
  args: { path: string };
}

export interface WorkspaceGrepToolEvent extends ToolEventBase {
  tool: "mastra_workspace_grep";
  args: { pattern: string; path?: string };
}

export interface WorkspaceListFilesToolEvent extends ToolEventBase {
  tool: "mastra_workspace_list_files";
  args: { path?: string; recursive?: boolean };
}

export interface WorkspaceEditFileToolEvent extends ToolEventBase {
  tool: "mastra_workspace_edit_file";
  args: { path: string; find: string; replace: string };
}

export interface WorkspaceMkdirToolEvent extends ToolEventBase {
  tool: "mastra_workspace_mkdir";
  args: { path: string };
}

export interface WorkspaceDeleteToolEvent extends ToolEventBase {
  tool: "mastra_workspace_delete";
  args: { path: string };
}

export interface WorkspaceFileStatToolEvent extends ToolEventBase {
  tool: "mastra_workspace_file_stat";
  args: { path: string };
}

export interface WorkspaceBashToolEvent extends ToolEventBase {
  tool: "workspace_bash";
  args: { argv: string[]; cwd?: string };
}

export interface FinalizeReportToolEvent extends ToolEventBase {
  tool: "finalize_report";
  args: { sql: string; csvResults: string; narrative: string };
}

export interface UnknownToolEvent extends ToolEventBase {
  tool: string;
  args: Record<string, unknown>;
}

export interface ErrorCtx {
  error: Error;
  ctx: Record<string, unknown>;
}

export interface MemorySaveCtx {
  memory: unknown;
  scope: string;
  userId: string;
  ownerId?: string;
}

export interface MemoryDeleteCtx {
  memory: unknown;
  scope: string;
  userId: string;
  ownerId?: string;
}

export type ToolApprovalPolicy =
  | boolean
  | { tools: string[] }
  | { exceptTools: string[] }
  | ((
      toolName: string,
      args: Record<string, unknown>,
      requestContext?: unknown,
    ) => boolean | Promise<boolean>);

export interface LimitConfig {
  rowsPerQuery?: number;
  queryTimeoutMs?: number;
  tokensPerRequest?: number;
  tokensPerUserPerMonth?: number;
  maxSteps?: number;
  requireToolApproval?: ToolApprovalPolicy;
}

export interface SourceAdapterExecuteOpts<TQuery> {
  query: TQuery;
  runAsRole?: string;
  userId: string;
  rowLimit: number;
  timeoutMs: number;
  params?: readonly unknown[];
  credentials?: unknown;
}

export interface SourceAdapterExecuteResult<TResult> {
  rows: TResult[];
  rowCount: number;
  durationMs: number;
  truncated: boolean;
}

export interface SourceAdapterCompileMetricOpts {
  entity: unknown;
  metric: string;
  dimensions?: string[];
  filters?: Record<string, unknown>;
  segments?: string[];
}

export interface SourceAdapterCompileMetricResult<TQuery> {
  query: TQuery;
  params?: unknown[];
}

type MetricCompilerName = `compile${"Metric"}`;

export type SourceAdapter<TQuery, TResult = Record<string, unknown>> = {
  readonly kind: string;
  readonly id: string;
  execute(
    opts: SourceAdapterExecuteOpts<TQuery>,
  ): Promise<SourceAdapterExecuteResult<TResult>>;
  introspect(): Promise<unknown>;
  verifyOwnerIdentity(expectedOwnerId: string): Promise<void>;
  close?(): Promise<void>;
} & Partial<
  Record<
    MetricCompilerName,
    (
      opts: SourceAdapterCompileMetricOpts,
    ) => SourceAdapterCompileMetricResult<TQuery>
  >
>;

export interface ToolCallTrace {
  tool: string;
  args: Record<string, unknown>;
  output?: Record<string, unknown>;
}
