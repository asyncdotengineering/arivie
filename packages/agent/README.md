# @arivie/agent

Mastra agent package for Arivie — registers `execute_<sourceName>` tools per configured `SourceAdapter`, optional `compile_metric`, and REQ-53 contract invariants via `assertToolShape`.

`executeToolFor` wraps read-only SQL execution with per-user Postgres roles, SQL allowlisting, and lifecycle hooks. `compileMetricFor` compiles semantic-layer metrics into parameterised SQL and executes via the same adapter boundary.

**Workspace:** Pass a Mastra `Workspace` from `@arivie/workspace` (`makeWorkspaceWithUploads`). Local semantic-layer filesystem (`kind: "local"`) or sandboxed implementations (`in-process`, `vercel`, `docker`). Sandboxed workspaces use `finalizeReport: false` until Sprint 2 ships the `finalize_report` tool.

Public surface: RFC-003 v2 §4.7 / REQ-53.

## License

Apache-2.0
