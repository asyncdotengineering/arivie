# @arivie/source-mcp

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
  - @arivie/core@3.0.0

## 0.2.1

### Patch Changes

- Updated dependencies
  - @arivie/core@1.1.0

## 0.2.0

### Minor Changes

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

### Patch Changes

- Updated dependencies
  - @arivie/core@1.0.0

## 0.2.0

### Minor Changes

- Test two minor deps

### Patch Changes

- @arivie/core@1.0.0

## 0.1.1

### Patch Changes

- @arivie/core@0.1.2

## 0.2.0

### Minor Changes

- Test mastra upgrade without core

### Patch Changes

- @arivie/core@1.0.0

## 0.1.1

### Patch Changes

- @arivie/core@0.1.2
