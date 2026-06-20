---
issue: 09-c9-run-evals-runner
rfc: rfc-tool-approval-and-run-evals
chunk: C9
status: todo
depends_on:
  - 08-c8-export-scorer
estimate: medium
files:
  - scripts/run-eval.ts
grounding: REQ-5, REQ-8, REQ-9
acceptance_criteria: Uses runEvals; maps deprecated modes; preserves CLI/summary/artifact
assignee: null
delegate_slug: null
review_verdict: null
---

# C9 — Migrate runner to `runEvals`

RFC Section 8 row C9.

Refactor `scripts/run-eval.ts` to use Mastra `runEvals` with the composite scorer.
