---
name: quarterly-revenue-recap
description: Quarterly revenue recap — headline number plus top-country contributor and outstanding-amount sanity check. For "how's revenue this quarter" / "quarterly revenue summary" type questions.
when_to_use: |
  Load this skill when the user asks about:
    - "What is our revenue this quarter"
    - "How's revenue this quarter" / "Quarterly revenue recap"
    - "Revenue summary for the quarter"
  DON'T load for:
    - Attribution by marketing channel → use revenue-attribution
    - Pure single-number lookups with no breakdown desired → just `compile_metric({metric: "revenue", segments: ["current_quarter"]})`
inputs:
  - { name: window, type: string, default: "current_quarter", description: "Declared segment to scope the recap" }
outputs:
  - { name: headline, type: string, description: "One-line recap: total revenue + top-contributing country + outstanding amount" }
sources:
  - postgres
---

# Quarterly revenue recap

A three-shot playbook the agent must follow before answering. Don't paraphrase; run the three `compile_metric` calls, then synthesize.

## Phase 1 — Headline revenue

```ts
compile_metric({ metric: "revenue", segments: ["current_quarter"] })
```

This is the headline. Capture the number.

## Phase 2 — Top country contributor

```ts
compile_metric({
  metric: "revenue",
  dimensions: ["customers.country"],
  segments: ["current_quarter"],
})
```

Sort rows desc by `revenue`. The top row's country + share-of-total is the top-contributor callout.

## Phase 3 — Outstanding-amount sanity check

```ts
compile_metric({ metric: "outstanding_amount", segments: ["current_quarter"] })
```

This surfaces unpaid value in-flight this quarter. If `outstanding_amount` is > 30% of `revenue`, mention it as a follow-up worth investigating.

## Output format

- **Result:** "$<headline> in completed revenue this quarter. <country> leads at <share>% (<$amount>). Outstanding: <$outstanding>."
- **Assumptions:** revenue = `SUM(total_amount) FILTER (WHERE status='completed')`; outstanding = `SUM(total_amount - amount_paid) FILTER (WHERE status NOT IN ('paid','void','draft'))`; window = `created_at >= date_trunc('quarter', CURRENT_DATE)`.
- **SQL:** inline all three queries the dispatcher emitted.

## Self-correction

- **Top-country share is 100%?** Either only one country in the data, or the GROUP BY didn't apply — re-check the dispatched SQL.
- **Outstanding > revenue?** Plausible if many large orders are in-flight; flag explicitly rather than hiding.
- **Revenue is 0?** The `status='completed'` filter may be excluding everything in the window. Run a no-filter count to confirm orders exist.
