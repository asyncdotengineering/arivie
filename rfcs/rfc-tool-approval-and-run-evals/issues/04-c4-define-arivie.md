---
issue: 04-c4-define-arivie
rfc: rfc-tool-approval-and-run-evals
chunk: C4
status: todo
depends_on:
  - 03-c3-make-agent
  - 02-c2-schema
estimate: small
files:
  - packages/core/src/define.ts
grounding: REQ-2
acceptance_criteria: makeAgent receives requireToolApproval from parsed.limits; no new type errors
assignee: null
delegate_slug: null
review_verdict: null
---

# C4 — Thread policy through `defineArivie`

RFC Section 8 row C4.

Pass `requireToolApproval` from `parsed.limits` into `makeAgent` options.
