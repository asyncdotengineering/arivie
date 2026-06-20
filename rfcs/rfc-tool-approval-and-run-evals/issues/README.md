# RFC rfc-tool-approval-and-run-evals — Issue Tracker

| Chunk | Status | Files | Grounding | Acceptance | Review |
|-------|--------|-------|-----------|------------|--------|
| C1 | done | `packages/core/src/types.ts` | REQ-1 | ToolApprovalPolicy exported; LimitConfig includes it; typecheck green | ready |
| C2 | done | `packages/core/src/config.ts` | REQ-1 | Schema accepts bool/allowlist/denylist/function | ready |
| C3 | done | `packages/agent/src/make-agent.ts` | REQ-2, REQ-3 | defaultOptions.requireToolApproval set | ready |
| C4 | done | `packages/core/src/define.ts` | REQ-2 | makeAgent receives requireToolApproval from parsed.limits | ready |
| C5 | done | `packages/agent/test/make-agent.test.ts` | REQ-2, REQ-3 | Tests prove gating behavior | ready |
| C6 | done | `packages/core/src/eval/helpers.ts` | REQ-5, REQ-6 | Shared eval helpers moved | ready |
| C7 | done | `packages/core/src/eval/dogfood-scorer.ts` | REQ-6, REQ-7 | Composite scorer built | ready |
| C8 | done | `packages/core/src/eval/index.ts` | REQ-6 | createDogfoodScorer exported | ready |
| C9 | done | `scripts/run-eval.ts` | REQ-5, REQ-8, REQ-9 | Runner uses runEvals | ready |
| C10 | done | `packages/core/test/dogfood-scorer.test.ts` | REQ-7 | Unit tests for scorer | ready |
| C11 | blocked | `scripts/run-eval.ts` | REQ-8, cmd:eval-mock | Docker unavailable in this environment; code reviewed and typecheck/build/unit-test green | - |
| C12 | done | monorepo | REQ-10 | `pnpm typecheck`, `pnpm build`, `pnpm test` green | ready |
