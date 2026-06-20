---
issue: 05-c5-tool-approval-tests
rfc: rfc-tool-approval-and-run-evals
chunk: C5
status: todo
depends_on:
  - 04-c4-define-arivie
estimate: small
files:
  - packages/core/test/tool-approval.test.ts
grounding: REQ-2, REQ-3
acceptance_criteria: Tests prove allowlist/denylist/function gate the right tools; default no gate
assignee: null
delegate_slug: null
review_verdict: null
---

# C5 — Tool approval unit tests

RFC Section 8 row C5.

Create `packages/core/test/tool-approval.test.ts` verifying policy normalization and gating behavior.
