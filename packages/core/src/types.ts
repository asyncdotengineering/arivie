/* SPDX-License-Identifier: Apache-2.0 */
import type { EmbeddingProvider } from "@arivie/embeddings";
import type { Entity, SemanticLayer } from "@arivie/semantic";
import type { Workspace } from "@mastra/core/workspace";
import type { WorkspaceFilesystem } from "@mastra/core/workspace";
import type { MastraVector } from "@mastra/core/vector";
import type { LanguageModel } from "ai";

/**
 * Workspace configuration. Defaults are deliberately useful: omit and you
 * get a writable in-process sandbox rooted at `semantic.path`. Pass
 * `bash: true` to surface `workspace_bash` so the agent can run shell
 * utilities (jq, awk, python -c …) within the sandbox.
 */
export interface WorkspaceConfig {
  /** Sandbox root directory. Falls back to `semantic.path` when omitted. */
  rootDir?: string;
  /**
   * Custom filesystem implementation. Escape hatch for non-local sandboxes
   * (Docker, Vercel, Cloudflare Containers). When set, takes precedence
   * over `rootDir`.
   */
  filesystem?: WorkspaceFilesystem;
  /**
   * Opt into `workspace_bash`. Requires a sandboxed filesystem (the in-
   * process default qualifies). Lets the agent run allowlisted binaries
   * (python3, node, jq, awk, …) inside the workspace.
   */
  bash?: boolean;
  /** Index workspace + skills for BM25-backed semantic search. */
  bm25?: boolean;
  /**
   * Register the `finalize_report` tool. Defaults to true on sandboxed
   * filesystems. Set false to omit even when the filesystem supports it.
   */
  finalizeReport?: boolean;
}

export type MCPServerConfig = {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
};

/**
 * Source entry shape. Every source MUST carry a `description` and SHOULD
 * carry a `useWhen` — both are surfaced in the agent's system prompt so
 * the model can pick the right source for a question. Just like tools and
 * agents, sources are picked from a menu, and the menu items need labels.
 *
 *   - `description` — one sentence: what's *in* this source (tables,
 *     business domain, freshness). The model reads this to know what it
 *     can answer.
 *   - `useWhen` — one phrase: when to reach for this source over another.
 *     Especially useful with 2+ sources to disambiguate ("orders questions"
 *     vs "user-behavior questions").
 */
export type SourceConfigEntry =
  | {
      kind: "adapter";
      adapter: SourceAdapter<unknown>;
      description: string;
      useWhen?: string;
    }
  | {
      kind: "mcp";
      mcp: MCPServerConfig;
      description: string;
      useWhen?: string;
    };

/** Multi-adapter declaration slot (RFC-003 v2 REQ-44). */
export type SourcesConfig = Record<string, SourceConfigEntry>;

/**
 * Infrastructure storage adapter for the Arivie instance — backs Mastra
 * Memory (chat threads + messages) AND the owner-identity / boundary
 * verification on the request handler.
 *
 * This is separate from `sources:` by design: sources are user-named
 * domain DBs the agent queries via `execute_<name>`. Storage is
 * infrastructure — one per Arivie instance, always Postgres for now.
 *
 * Defined inline (not as `import("@arivie/db-postgres").PostgresAdapter`)
 * to break the d.ts boot cycle — db-postgres imports from
 * @arivie/core/types, so core's types can't reference db-postgres back.
 * Structurally compatible with PostgresAdapter; PostgresAdapter is
 * assignable to StorageAdapter.
 */
export interface StorageAdapter {
  readonly kind: "postgres";
  readonly id: string;
  readonly url: string;
  // Use `any` here to bridge the postgres.Sql tagged-template surface
  // without importing the `postgres` types into core (would re-introduce
  // the boot cycle via db-postgres's transitive dep graph). PostgresAdapter
  // tightens this to `postgres.Sql` at the db-postgres consumer site.
  // biome-ignore lint/suspicious/noExplicitAny: see comment above
  sql: any;
  verifyOwnerIdentity(expectedOwnerId: string): Promise<void>;
  setupRole(
    role: string,
    options?: { allowedTables?: string[] },
  ): Promise<void>;
  close?(): Promise<void>;
}

/**
 * Source metadata pulled off a {@link SourceConfigEntry} — emitted by
 * `resolveSources` for the system-prompt builder.
 */
export interface SourceMetadata {
  name: string;
  description: string;
  useWhen?: string;
}

/**
 * Configuration for `defineArivie`. Hoists the high-traffic ergonomics
 * (skills, skillsMode, compileMetric) to the top level so the common
 * call reads like a single sentence rather than a nested literal.
 */
export interface ArivieConfig {
  owner: { id: string; name: string };
  /**
   * Infrastructure storage for Mastra Memory (threads + messages) and
   * owner-identity verification. Always Postgres for now. Separate from
   * `sources:` by design — those are user-named domain DBs.
   */
  storage: StorageAdapter;
  model: LanguageModel;
  semantic: SemanticConfig;
  sources: SourcesConfig;
  resolveUser: ResolveUser;
  /** Workspace primitive (filesystem + skills + opt-in bash). Optional. */
  workspace?: WorkspaceConfig;
  /**
   * Path(s) to SOP skill directories. Each path is a directory of
   * `<skill-name>/SKILL.md` playbooks the agent can load. A single string
   * accepts either a directory of skills or a single skill folder.
   */
  skills?: string | string[];
  /**
   * `"eager"` injects skill bodies into every turn. `"on-demand"` surfaces
   * `search_skills` / `load_skill` / `skill_read` tools so the agent
   * fetches lazily. `"auto"` picks: ≤6 skills → eager, >6 → on-demand.
   */
  skillsMode?: "eager" | "on-demand" | "auto";
  /** Register `compile_metric` so the agent can name canonical measures. */
  compileMetric?: boolean;
  hooks?: LifecycleHooks;
  limits?: LimitConfig;
  /**
   * Recurring analytical prompts wired to Mastra's workflow scheduler.
   * Schedules are operational runtime config — they live here, not in
   * `SKILL.md` frontmatter.
   */
  schedules?: import("./schedules.js").ArivieSchedule[];
  /**
   * Mastra Observability instance for tracing and scoring. Optional;
   * when provided it is passed through to the Mastra runtime.
   */
  observability?: import("@mastra/observability").Observability;
}

export interface SemanticConfig {
  path: string;
  mode: "auto" | "preload" | "indexed";
  embeddings?: EmbeddingsConfig;
  layer?: SemanticLayer;
}

export interface EmbeddingsConfig {
  provider: EmbeddingProvider;
  vector: MastraVector;
  indexName: string;
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
  mode?: SemanticConfig["mode"];
}

export interface AfterQueryCtx {
  sql: string;
  rows: Record<string, unknown>[];
  durationMs: number;
  cost?: number;
  userId: string;
  ownerId: string;
}

/**
 * Discriminated-union tool-call event. Branches by tool name so
 * `event.args` narrows correctly inside the handler:
 *
 * ```ts
 * onToolCall: (event) => {
 *   if (event.tool === "execute_postgres") {
 *     event.args.sql;  // typed string
 *   } else if (event.tool === "mastra_workspace_write_file") {
 *     event.args.path; // typed string
 *   }
 * }
 * ```
 */
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

/**
 * Policy for requiring human approval before a tool call runs.
 * - `false` / omitted — no gate.
 * - `true` — every tool call requires approval.
 * - `{ tools: string[] }` — only listed tools require approval.
 * - `{ exceptTools: string[] }` — all tools except listed require approval.
 * - function — custom predicate evaluated per call.
 */
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
  /** Require human approval before selected tool calls run. */
  requireToolApproval?: ToolApprovalPolicy;
}

/** Options passed to {@link SourceAdapter.execute}. */
export interface SourceAdapterExecuteOpts<TQuery> {
  query: TQuery;
  runAsRole?: string;
  userId: string;
  rowLimit: number;
  timeoutMs: number;
  params?: readonly unknown[];
  credentials?: unknown;
}

/** Result returned by {@link SourceAdapter.execute}. */
export interface SourceAdapterExecuteResult<TResult> {
  rows: TResult[];
  rowCount: number;
  durationMs: number;
  truncated: boolean;
}

/** Options passed to {@link SourceAdapter.compileMetric}. */
export interface SourceAdapterCompileMetricOpts {
  entity: Entity;
  metric: string;
  dimensions?: string[];
  filters?: Record<string, unknown>;
  segments?: string[];
}

/** Result returned by {@link SourceAdapter.compileMetric}. */
export interface SourceAdapterCompileMetricResult<TQuery> {
  query: TQuery;
  params?: unknown[];
}

/**
 * Generic data-source adapter contract (RFC-003 v2 §4.7, REQ-41).
 */
export interface SourceAdapter<TQuery, TResult = Record<string, unknown>> {
  readonly kind: string;
  readonly id: string;
  execute(
    opts: SourceAdapterExecuteOpts<TQuery>,
  ): Promise<SourceAdapterExecuteResult<TResult>>;
  introspect(): Promise<unknown>;
  verifyOwnerIdentity(expectedOwnerId: string): Promise<void>;
  /** Release connections and child processes (MCP stdio servers, Postgres pools). */
  close?(): Promise<void>;
  compileMetric?(
    opts: SourceAdapterCompileMetricOpts,
  ): SourceAdapterCompileMetricResult<TQuery>;
}

/**
 * Options for {@link ArivieInstance.ask}. The typed facade hides
 * `runWithUserContext` + the Mastra `memory: { thread, resource }`
 * plumbing that every `agent.generate(...)` call needs.
 */
export interface AskOptions {
  /** Natural-language prompt the agent should answer. */
  prompt: string;
  /** User identity + permissions + DB role for this turn. */
  user: UserContext;
  /** Thread ID for Mastra Memory persistence. Defaults to a generated one. */
  thread?: string;
  /** Resource ID for Mastra Memory persistence. Defaults to `user.userId`. */
  resource?: string;
}

/**
 * One step in the agent's tool-call trace. Lightweight reflection of what
 * the agent did, without the loose `Record<string, unknown>` walk you'd
 * otherwise have to do over `agent.generate(...)`'s response.
 */
export interface ToolCallTrace {
  tool: string;
  args: Record<string, unknown>;
  output?: Record<string, unknown>;
}

/**
 * Strongly-typed result from {@link ArivieInstance.ask}. The framework
 * does the response-message walking for you and surfaces the bits you
 * actually want (final text, SQL run, files written) up top, with the
 * raw response kept on `.raw` as an escape hatch.
 */
export interface AskResult {
  /** The agent's final user-facing answer. */
  text: string;
  /** Every tool call the agent made during this turn, in order. */
  toolCalls: ToolCallTrace[];
  /** SQL statements executed against any source this turn. */
  sql: string[];
  /** Paths of files the agent wrote via `mastra_workspace_write_file`. */
  artifacts: string[];
  /** The original `agent.generate(...)` return value, untyped. */
  raw: unknown;
}

export interface ArivieInstance {
  /**
   * The Arivie analytics agent. Single agent surface: text-to-SQL over
   * the semantic layer (`compile_metric` + `execute_<source>`) plus
   * workspace tools (read/write/grep/edit + opt-in bash) attached
   * directly to the same model that runs the SQL. No supervisor, no
   * sub-agents — rows stay in one scratchpad from SQL through to file
   * write, eliminating the prose-handoff boundary that lets weak models
   * fabricate numbers.
   *
   * Prefer {@link ArivieInstance.ask} for one-shot calls; reach for
   * `.agent.generate(...)` directly only when you need streaming or
   * Mastra-specific options not surfaced on `ask()`.
   */
  agent: import("@mastra/core/agent").Agent;
  mastra: import("@mastra/core").Mastra;
  workspace: Workspace;
  /**
   * Typed one-shot facade over `agent.generate(...)`. Sets up the
   * `runWithUserContext` AsyncLocalStorage frame and Mastra Memory
   * thread for you; returns an {@link AskResult} with `text`,
   * `toolCalls`, `sql`, and `artifacts` extracted up front.
   */
  ask(opts: AskOptions): Promise<AskResult>;
  /**
   * Web Standard request handler. Drop into ANY web host that speaks
   * Fetch — no framework adapter needed. See `defineArivie` for usage
   * patterns per framework.
   */
  handler: (req: Request) => Promise<Response>;
  /** Pre-wired Hono app — convenience for the Hono case. */
  hono: import("hono").Hono;
  /** Close all source adapters that expose {@link SourceAdapter.close}. */
  dispose(): Promise<void>;
}

/** @deprecated Use `arivie.handler` directly — no adapter needed. */
export interface ExportedHandler {
  fetch(
    request: Request,
    env: unknown,
    ctx: {
      waitUntil(promise: Promise<unknown>): void;
      passThroughOnException(): void;
    },
  ): Response | Promise<Response>;
}
