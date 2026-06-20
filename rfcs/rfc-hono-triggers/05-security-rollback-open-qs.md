---
rfc: hono-triggers
part: 05-security-rollback-open-qs
---

# 10. Security Considerations

- **Webhook verification is provider-owned.** Arivie core never sees webhook secrets. Each channel package (e.g., `@arivie/github`) verifies signatures using the provider's algorithm before emitting an event. This matches Flue's boundary table (`docs/guide/channels/index.md`).

- **Raw request bodies are not logged.** Channel handlers receive the Hono context but must not log `c.req.raw` bodies or secret headers. `TriggerEvent.metadata.rawRequest` is intentionally exposed only as an escape hatch and must not be passed to models or durable storage.

- **Subscription targets are static or pure functions.** `target.instanceId` and `target.input` may be functions, but they run in framework code, not model context. They must not execute arbitrary provider SDK operations.

- **No secret passthrough in `TriggerEvent.payload` or `input`.** Channel authors must strip secrets, short-lived tokens, and response URLs before emitting events. The GitHub reference channel emits only `number`, `title`, `body`, and `repository`.

- **Middleware applies before channels.** If the user mounts `arivie()` under `/api` with auth middleware on `/api/channels/*`, unverified requests are rejected before channel verification runs.

- **Cloudflare target:** generated Worker entries must not embed secrets in the bundle. Secrets remain environment bindings; channel configs read them from `process.env` / `env` at runtime.

# 11. Rollback and Abort Criteria

- **Abort if `@mastra/hono` is incompatible with Mastra 1.45 APIs used by Arivie.** Mastra's adapter must be tested against the exact `@mastra/core@1.45.0` baseline before C8 proceeds.

- **Abort if `ArivieInstance.handler` or `.hono` regress.** The single-agent chat path is production-critical; any change that breaks `pnpm test` for handler tests is a stop.

- **Abort if generated Node entry cannot start.** `cmd:buildNode` must produce a server that responds to `/api/agents/arivie` without crashing.

- **Rollback procedure:** Revert the PR. The old handler path remains in `packages/core/src/handler.ts`; no migration of persisted data is required because this change is purely server composition.

- **Symptom-patch abort:** If a chunk passes its own test but a downstream integration test fails with a workaround (e.g., `// @ts-ignore`, hardcoded port, skipped verification), stop and re-RFC the affected interface.

# 12. Open Questions

All questions below have committed proposals; kickoff is unblocked.

- Q1: Should Arivie ship a generic webhook trigger package (`@arivie/webhook`) or only provider-specific channels?
  - **Tradeoff:** Generic triggers let users hand-verify any HTTP source, but they push security responsibility to users. Provider-specific channels are safer but require more packages.
  - **Proposal:** Ship only provider-specific first-party channels (GitHub first, Slack/Discord later). The `defineTrigger` primitive is public, so users can build generic triggers in their own codebases.

- Q2: Should the legacy `ArivieInstance.hono` be deprecated or kept indefinitely?
  - **Tradeoff:** Deprecation nudges users to `instance.app` but requires migration docs. Keeping both creates a small API surface duplication.
  - **Proposal:** Keep `handler` and `hono` indefinitely but document `app` as the preferred surface. No deprecation warning in this cut.

- Q3: Should the Cloudflare target use Durable Objects for agent instances or rely on Mastra's storage?
  - **Tradeoff:** Durable Objects give true durable execution but require generated classes and migration management. Mastra's Postgres-backed memory works on Cloudflare via Hyperdrive but is not as durable for in-flight runs.
  - **Proposal:** First cut uses Mastra's standard Postgres storage + Worker fetch handler. A future RFC can add Durable Object per-agent instances if needed.

- Q4: Should `defineSubscription` support async `filter`, `instanceId`, and `input` functions?
  - **Tradeoff:** Async resolution is more flexible but complicates error handling and testing. Sync-only is simpler but may force users to precompute values.
  - **Proposal:** Support async `instanceId` and `input` resolvers; keep `filter` sync to keep the dispatch path predictable. Document that async resolvers must not perform external side effects.
