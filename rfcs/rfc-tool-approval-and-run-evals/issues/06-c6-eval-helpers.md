---
issue: 06-c6-eval-helpers
rfc: rfc-tool-approval-and-run-evals
chunk: C6
status: todo
depends_on: []
estimate: small
files:
  - packages/core/src/eval/helpers.ts
  - packages/core/src/eval/index.ts
  - scripts/run-eval.ts
grounding: REQ-5, REQ-6
acceptance_criteria: countExecuteCalls, answerClaimsZeroRevenue, runValidationRules move to @arivie/core/eval
assignee: null
delegate_slug: null
review_verdict: null
---

# C6 — Extract shared eval helpers

RFC Section 8 row C6.

Move reusable eval helpers from `scripts/run-eval.ts` into `@arivie/core/eval`.
