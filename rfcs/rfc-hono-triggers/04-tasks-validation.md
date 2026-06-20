---
rfc: hono-triggers
part: 04-tasks-validation
---

# 8. Incremental Task Breakdown

| ID | Chunk | Files | Grounding (REQ/test) | Acceptance criteria |
|----|-------|-------|----------------------|---------------------|
| C1 | Add `hono` and `@mastra/hono` deps; verify current suite still green | `package.json`, `pnpm-lock.yaml` | cmd:install, cmd:typecheck | `pnpm install` and `pnpm typecheck` pass |
| C2 | Trigger types + `defineTrigger` factory with validation | `packages/core/src/triggers/types.ts`, `packages/core/src/triggers/define.ts` | REQ-4, test:defineTrigger | Invalid route paths throw; valid definitions round-trip |
| C3 | `defineChannel` factory | `packages/core/src/triggers/channel.ts` | REQ-4, test:defineChannel | Bad names throw; good names return frozen object |
| C4 | `defineSubscription` factory | `packages/core/src/triggers/subscription.ts` | REQ-4, test:defineSubscription | Target resolution helpers typed |
| C5 | Trigger route registry and matcher | `packages/core/src/server/channel-route.ts`, `packages/core/src/server/trigger-route.ts` | REQ-6, test:channelRouteHandler | Unknown channel 404; wrong method 405; known route invokes handler |
| C6 | Subscription dispatch to agent | `packages/core/src/server/dispatch.ts` | REQ-7, test:dispatchAgent | Event emitted → `mastra.getAgent(id).generate` called with resolved thread id |
| C7 | Subscription dispatch to workflow | `packages/core/src/server/dispatch.ts` | REQ-7, test:dispatchWorkflow | Event emitted → workflow run started with inputData |
| C8 | `arivie()` Hono sub-app composing MastraServer + channels | `packages/core/src/server/index.ts`, `packages/core/src/server/compose.ts` | REQ-1, test:arivieServer | Mastra agent route reachable; channel route reachable under prefix |
| C9 | `createArivieServer` discovery helper | `packages/core/src/server/discovery.ts` | REQ-3, test:discoverChannels | Discovers `channels/*.ts` and `subscriptions/*.ts` modules |
| C10 | Update `ArivieInstance` with `.app`; keep `.handler`/`.hono` | `packages/core/src/types.ts`, `packages/core/src/define.ts` | REQ-2, test:instanceApp | `instance.app` is the new sub-app; old handler still works |
| C11 | Reference GitHub channel package | `packages/github/src/channel.ts`, `packages/github/src/verify.ts`, `packages/github/package.json` | REQ-8, test:githubChannelVerify | Signature verification rejects bad payloads; accepts good payloads |
| C12 | CLI `build` command skeleton + `--target` parsing | `packages/cli/src/commands/build.ts`, `packages/cli/src/cli.ts` | REQ-9, test:buildCommandArgs | `arivie build --target node` and `--target cloudflare` parse |
| C13 | Node build plugin + entry generation | `packages/cli/src/lib/build/plugins/node.ts`, `packages/cli/src/lib/build/build.ts` | REQ-10, test:nodeBuildEntry | Generated entry imports channels/subscriptions and mounts `arivie()` |
| C14 | Vite bundle step for Node target | `packages/cli/src/lib/build/build.ts` | REQ-10, cmd:buildNode | `arivie build --target node` produces `dist/server.mjs` |
| C15 | Cloudflare build plugin skeleton | `packages/cli/src/lib/build/plugins/cloudflare.ts` | REQ-11, test:cloudflareBuildEntry | Generates Worker entry with MastraServer + `export default { fetch }` |
| C16 | Docs: server, channels, subscriptions, build | `docs/src/content/docs/concepts/channels.mdx`, `docs/src/content/docs/guides/deploy/node.mdx`, `docs/src/content/docs/guides/deploy/cloudflare.mdx` | REQ docs | New docs render without broken links |

---

# 9. Validation and Testing

## 9.0 Validation Contract

| ID | Source | Assertion |
|----|--------|-----------|
| REQ-1 | §3 | `arivie()` returns a Hono app with Mastra + Arivie routes |
| REQ-2 | §3 | `ArivieInstance.handler` and `.hono` still answer single-agent chat |
| REQ-3 | §3 | Optional `app.ts` can mount `arivie()` and add middleware |
| REQ-4 | §3 | `defineTrigger`, `defineChannel`, `defineSubscription` exist and validate |
| REQ-5 | §3 | Events emitted by triggers carry `{ type, payload, metadata }` |
| REQ-6 | §3 | Channels mount at `/channels/:name/:suffix`; triggers at `/triggers/:name/:suffix` |
| REQ-7 | §3 | Subscriptions resolve instance id and continue Mastra Memory threads |
| REQ-8 | §3 | Verification runs inside the channel package, not Arivie core |
| REQ-9 | §3 | CLI has `arivie build --target node|cloudflare` |
| REQ-10 | §3 | Node target produces a runnable `dist/server.mjs` |
| REQ-11 | §3 | Cloudflare target produces a Worker artifact |
| REQ-12 | §3 | Schedules remain Mastra scheduled workflows |
| REQ-13 | §3 | Every chunk has a failing-to-pass test |
| test:defineTrigger | §9.1 | Invalid route path throws; valid passes |
| test:defineChannel | §9.1 | Bad channel name throws; good passes |
| test:channelRouteHandler | §9.1 | Unknown channel 404; wrong method 405; known route executes |
| test:dispatchAgent | §9.1 | Emitted event reaches mocked agent.generate with right thread |
| test:dispatchWorkflow | §9.1 | Emitted event reaches mocked workflow.createRun().start |
| test:arivieServer | §9.1 | Mastra route + channel route both reachable in one Hono app |
| test:githubChannelVerify | §9.1 | Bad signature 401; good signature emits event |
| test:nodeBuildEntry | §9.1 | Generated entry contains expected imports and `serve()` call |
| cmd:install | §9.3 | `pnpm install` exits 0 |
| cmd:typecheck | §9.3 | `pnpm typecheck` exits 0 |
| cmd:test | §9.3 | `pnpm test` exits 0 |
| cmd:buildNode | §9.3 | `arivie build --target node` in fixture exits 0 and emits `dist/server.mjs` |

## 9.1 Fail-to-Pass Tests

- `packages/core/test/triggers/define-trigger.test.ts`
  - `it('throws when route path does not start with /')`
  - `it('returns the definition for valid routes')`

- `packages/core/test/triggers/define-channel.test.ts`
  - `it('throws when name is empty')`
  - `it('throws when name contains /')`
  - `it('returns the channel for valid input')`

- `packages/core/test/server/channel-route-handler.test.ts`
  - `it('returns 404 for unknown channel')`
  - `it('returns 405 for wrong method with allowed list')`
  - `it('executes matched route and returns its response')`

- `packages/core/test/server/dispatch.test.ts`
  - `it('calls agent.generate with resolved instance id when target kind is agent')`
  - `it('calls workflow.createRun().start with inputData when target kind is workflow')`
  - `it('skips subscriptions whose filter returns false')`

- `packages/core/test/server/arivie-server.test.ts`
  - `it('mounts Mastra agent route and Arivie channel route under the same prefix')`

- `packages/github/test/channel.test.ts`
  - `it('rejects requests with invalid signature')`
  - `it('emits github.pull_request.opened for a valid PR webhook')`

- `packages/cli/test/build/node-entry.test.ts`
  - `it('generates an entry that imports discovered channels and subscriptions')`
  - `it('mounts arivie() and calls serve()')`

## 9.2 Regression Tests (Pass-to-Pass)

- `packages/core/test/define-arivie.test.ts` or equivalent existing tests — `ArivieInstance.handler` and `.hono` still behave.
- `packages/core/test/handler.test.ts` — owner verification and SSE streaming unchanged.
- `packages/cli/test/eval.test.ts` — `pnpm eval` still passes 12/12 in mock mode.
- `pnpm typecheck`, `pnpm test`, `pnpm build` at repo root.

## 9.3 Validation Commands

```bash
# After every chunk
pnpm install
pnpm typecheck
pnpm test

# Node target smoke (after C14)
cd fixtures/node-server
pnpm exec arivie build --target node
node dist/server.mjs &
SERVER_PID=$!
sleep 2
curl -s http://localhost:3000/api/agents/arivie | head -c 200
kill $SERVER_PID

# Cloudflare target smoke (after C15)
cd fixtures/cloudflare-worker
pnpm exec arivie build --target cloudflare
ls dist/_worker.js

# Full regression
pnpm eval
```
