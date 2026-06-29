## 3.1.0

### Minor Changes

- 61b3447: Zero-config MCP server + prompts + resources.

  - `npx -y @arivie/mcp` now boots a stdio MCP server with no configuration (new `arivie-mcp` bin). Tools, prompts, and resources are listable immediately; `DATABASE_URL` / `ARIVIE_SEMANTIC_PATH` upgrade it in place, and `query`/`ask` return actionable "configure X" errors when their dependency is unset.
  - `makeMcpServer` now registers MCP **prompts** (`analyze-metric`, `explore-schema`, `weekly-revenue-review`) and **resources** (`arivie://about`, `arivie://semantic/catalog`, `arivie://semantic/entity/{name}`) in addition to the `ask`/`query`/`schema`/`memory` tools.
  - `makeMcpServer` options (`agent`, `semantic`, `db`, `ownerId`, `ownerName`) are now all optional; with none it serves a built-in sample semantic layer. `makeMcpUiServer` still requires `agent`/`db`/`semantic`.

## 3.0.0

### Major Changes

- 3586aba: Arivie v3.0.0 — navigation-by-default knowledge delivery + OKF-shaped context layer.

  BREAKING (see [ADR 0006](./docs/adr/0006-knowledge-delivery-navigation-default-okf.md)):

  - **`@arivie/plugin-analytics`**: remove `mode` config (`"preload"` / `"auto"`). Navigation-by-default replaces preload — a cached governance core (entity catalog, join skeleton, glossary) sits behind the prompt-cache breakpoint; entity detail and knowledge concepts are fetched on demand via tools.
  - **`@arivie/context`**: OKF-shaped knowledge layer — markdown concepts carry `type: playbook | reference | term`, fronted by `index.md` catalog and `semantic:` cross-links to the executable semantic layer.
  - **`@arivie/agent`** / **`@arivie/core`**: system-prompt assembly and plugin config surface updated for the single navigation path.

  All `@arivie/*` packages move to 3.0.0 together (lockstep), consistent with prior releases.

### Patch Changes

- Updated dependencies [3586aba]
  - @arivie/agent@3.0.0
  - @arivie/semantic@3.0.0
  - @arivie/db-postgres@3.0.0
  - @arivie/ui-catalog@3.0.0

## 1.0.1

### Patch Changes

- @arivie/agent@0.2.1
- @arivie/db-postgres@0.1.2

## 1.0.0

### Patch Changes

- Arivie 20 June 2026 release

  Mastra 1.45 upgrade, Agent Skills spec, and schedule configuration:

  - Upgrade all `@mastra/*` dependencies to 1.45.0 / 1.21.0 / 1.11.0 / 1.14.0.
  - Migrate every `SKILL.md` file to the official Agent Skills spec format.
  - Add `defineSchedule` / `defineSchedules` configuration and wire schedules to Mastra Workflows with cron triggers.
  - Add `arivie add schedule <name>` CLI command.
  - Forward an optional Mastra `observability` instance through `ArivieConfig` to the Mastra runtime.
  - Remove compatibility glue (`asMastraMcpServer`, `LooseGen`, `applyMaxStepsDefault`) in favor of native Mastra APIs.

  Tool approval and HITL policy configuration:

  - Add `ToolApprovalPolicy` type to `ArivieConfig.limits` with support for global, allow-list, deny-list, and function-based policies.
  - Wire tool approval through to Mastra's native `requireToolApproval` / tool-suspension flow.
  - Export `normalizeRequireToolApproval` from `@arivie/agent` for reusable policy normalization.

  Dogfood eval harness using Mastra `runEvals` and PGlite:

  - Add `@arivie/core/eval` subpath exporting SQL-semantic scorer helpers and a composite dogfood scorer.
  - Migrate `scripts/run-eval.ts` from the legacy runner to Mastra `runEvals` with a composite scorer.
  - Add PGlite-backed database adapter and adapter selection so `pnpm eval` works without Docker by default.
  - Keep testcontainers path available via `USE_TESTCONTAINERS=1`.
  - Use Mastra `RequestContext` for probe metadata in `runEvals` and register the scorer with Mastra to suppress warnings.
  - Remove the broken `customers` join from the dogfood `orders` semantic entity.
  - Upgrade `@electric-sql/pglite` to 0.5.3 for socket-server compatibility.

- Updated dependencies
  - @arivie/agent@0.2.0
  - @arivie/ui-catalog@0.1.1
  - @arivie/db-postgres@0.1.1

## 0.0.0

- Initial `makeMcpServer` (Sprint 3 / S3-01): Mastra `MCPServer` with `ask`, `query`, `schema`, `memory` tools and `ask_arivie` agent bridge (REQ-26, RFC §4.7).
