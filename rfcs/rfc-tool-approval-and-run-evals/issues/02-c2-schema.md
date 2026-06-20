---
issue: 02-c2-schema
rfc: rfc-tool-approval-and-run-evals
chunk: C2
status: todo
depends_on:
  - 01-c1-types
estimate: small
files:
  - packages/core/src/config.ts
grounding: REQ-1
acceptance_criteria: ArivieConfigSchema accepts bool/allowlist/denylist/function and rejects invalid shapes; test added
assignee: null
delegate_slug: null
review_verdict: null
---

# C2 — Schema validation for approval policy

RFC Section 8 row C2.

Add `toolApprovalPolicySchema` and include it in `limitSchema`.
