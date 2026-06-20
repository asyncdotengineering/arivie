---
issue: 01-c1-types
rfc: rfc-tool-approval-and-run-evals
chunk: C1
status: todo
depends_on: []
estimate: small
files:
  - packages/core/src/types.ts
grounding: REQ-1
acceptance_criteria: ToolApprovalPolicy exported; LimitConfig includes it; typecheck green
assignee: null
delegate_slug: null
review_verdict: null
---

# C1 — Add `ToolApprovalPolicy` type and extend `LimitConfig`

RFC Section 8 row C1.

Add `ToolApprovalPolicy` and include `requireToolApproval?: ToolApprovalPolicy` in `LimitConfig`.
