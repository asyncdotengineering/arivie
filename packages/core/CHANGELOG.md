## 1.0.0

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
  - @arivie/agent@0.2.0
  - @arivie/source-mcp@0.2.0
  - @arivie/embeddings@0.1.1
  - @arivie/workspace@0.1.1
  - @arivie/db-postgres@0.1.1

## 0.0.0

- Initial skeleton (Sprint 0 / C02).
