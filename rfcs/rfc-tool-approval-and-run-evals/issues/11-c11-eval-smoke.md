---
issue: 11-c11-eval-smoke
rfc: rfc-tool-approval-and-run-evals
chunk: C11
status: todo
depends_on:
  - 09-c9-run-evals-runner
estimate: medium
files:
  - scripts/run-eval.ts
grounding: REQ-8, cmd:eval-mock
acceptance_criteria: pnpm eval with mock model exits 0/1 correctly and writes artifact
assignee: null
delegate_slug: null
review_verdict: null
---

# C11 — Integration smoke: mock eval

RFC Section 8 row C11.

Run `pnpm eval` end-to-end with the mock model and verify the artifact + threshold behavior.
