# RFC rfc-tool-approval-and-run-evals — Issue Tracker

| Chunk | Status | Files | Grounding | Acceptance | Review |
|-------|--------|-------|-----------|------------|--------|
| C1 | todo | `packages/core/src/types.ts` | REQ-1 | ToolApprovalPolicy exported; LimitConfig includes it; typecheck green | - |
| C2 | todo | `packages/core/src/config.ts` | REQ-1 | Schema accepts bool/allowlist/denylist/function | - |
| C3 | todo | `packages/agent/src/make-agent.ts` | REQ-2, REQ-3 | defaultOptions.requireToolApproval set | - |
| C4 | todo | `packages/core/src/define.ts` | REQ-2 | makeAgent receives requireToolApproval from parsed.limits | - |
| C5 | todo | `packages/core/test/tool-approval.test.ts` | REQ-2, REQ-3 | Tests prove gating behavior | - |
| C6 | todo | `packages/core/src/eval/helpers.ts` | REQ-5, REQ-6 | Shared eval helpers moved | - |
| C7 | todo | `packages/core/src/eval/dogfood-scorer.ts` | REQ-6, REQ-7 | Composite scorer built | - |
| C8 | todo | `packages/core/src/eval/index.ts` | REQ-6 | createDogfoodScorer exported | - |
| C9 | todo | `scripts/run-eval.ts` | REQ-5, REQ-8, REQ-9 | Runner uses runEvals | - |
| C10 | todo | `packages/core/test/dogfood-scorer.test.ts` | REQ-7 | Unit tests for scorer | - |
| C11 | todo | `scripts/run-eval.ts` | REQ-8, cmd:eval-mock | Mock eval smoke passes | - |
| C12 | todo | monorepo | REQ-10 | Matrix green | - |
