---
issue: 07-c7-dogfood-scorer
rfc: rfc-tool-approval-and-run-evals
chunk: C7
status: todo
depends_on:
  - 06-c6-eval-helpers
estimate: medium
files:
  - packages/core/src/eval/dogfood-scorer.ts
grounding: REQ-6, REQ-7
acceptance_criteria: Scorer returns 1/0 combining SQL semantic equivalence + validation rules
assignee: null
delegate_slug: null
review_verdict: null
---

# C7 — Build composite dogfood scorer

RFC Section 8 row C7.

Create `packages/core/src/eval/dogfood-scorer.ts` with `createDogfoodScorer`.
