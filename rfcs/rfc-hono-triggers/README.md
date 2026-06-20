# RFC: Hono server, event triggers, and target-aware builds

**Category:** Architectural Change
**Author:** opencode
**Date:** 2026-06-20
**Status:** Implemented
**Reviewers:** (self-driven, approved by user inline)
**Related:**
- `packages/core/src/define.ts` — `defineArivie`, current Hono passthrough (`honoApp.all("*", ...)`)
- `packages/core/src/handler.ts` — custom web handler, owner verification, SSE streaming
- `packages/core/src/types.ts` — `ArivieConfig`, `ArivieInstance`
- `packages/core/src/schedules.ts` — `defineSchedule`, schedule-as-workflow pattern
- `packages/cli/src/cli.ts` — existing CLI commands (no `build` command today)
- `packages/cli/src/commands/dev.ts` — dev server command
- `packages/cli/src/commands/deploy.ts` — deploy command stub
- Mastra `@mastra/hono` adapter (`server-adapters/hono/src/index.ts`)
- Flue `packages/runtime/src/runtime/flue-app.ts` — Hono sub-app pattern
- Flue `packages/cli/src/lib/build-plugin-node.ts` — Node build plugin
- Flue `packages/cli/src/lib/build-plugin-cloudflare.ts` — Cloudflare build plugin

---

## One-line summary

Replace Arivie's single-route custom handler with a Hono-based server composition that exposes Mastra's agent/workflow API through `@mastra/hono`, adds a first-class `defineTrigger`/`defineSubscription`/`defineChannel` event layer, and ships `arivie build --target node|cloudflare` so projects compile into deployable artifacts.

## Navigating this RFC

| Part | File | What's inside |
|------|------|---------------|
| 01 | [01-problem-background.md](./01-problem-background.md) | Current state, prior art from Mastra and Flue, why Hono |
| 02 | [02-requirements-interfaces.md](./02-requirements-interfaces.md) | REQ-* list and Section 4 interface specification |
| 03 | [03-pseudocode-blueprint.md](./03-pseudocode-blueprint.md) | Algorithms and concrete code sketches |
| 04 | [04-tasks-validation.md](./04-tasks-validation.md) | Section 8 WBS and Section 9 TDD validation plan |
| 05 | [05-security-rollback-open-qs.md](./05-security-rollback-open-qs.md) | Security, rollback, and open questions |
| 06 | [06-usage-guide.md](./06-usage-guide.md) | Usage guide for server, channels, subscriptions, and builds |

## Open Questions status

All Section 12 questions have committed proposals; kickoff is unblocked.
