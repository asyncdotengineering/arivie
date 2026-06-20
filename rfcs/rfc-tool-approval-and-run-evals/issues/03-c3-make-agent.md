---
issue: 03-c3-make-agent
rfc: rfc-tool-approval-and-run-evals
chunk: C3
status: todo
depends_on:
  - 01-c1-types
estimate: small
files:
  - packages/agent/src/make-agent.ts
grounding: REQ-2, REQ-3
acceptance_criteria: defaultOptions.requireToolApproval set from policy; function policies normalized
assignee: null
delegate_slug: null
review_verdict: null
---

# C3 — Normalize and apply policy in `makeAgent`

RFC Section 8 row C3.

Add `requireToolApproval` to `MakeAgentOptions`, normalize policy to Mastra `RequireToolApproval`, and set on `agentConfig.defaultOptions`.
