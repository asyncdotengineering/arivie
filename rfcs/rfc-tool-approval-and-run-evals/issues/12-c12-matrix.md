---
issue: 12-c12-matrix
rfc: rfc-tool-approval-and-run-evals
chunk: C12
status: todo
depends_on:
  - 05-c5-tool-approval-tests
  - 10-c10-dogfood-scorer-tests
  - 11-c11-eval-smoke
estimate: small
files: []
grounding: REQ-10
acceptance_criteria: pnpm typecheck, pnpm build, pnpm test green
assignee: null
delegate_slug: null
review_verdict: null
---

# C12 — Full matrix verification

RFC Section 8 row C12.

Run `pnpm typecheck`, `pnpm build`, and `pnpm test` and ensure all pass.
