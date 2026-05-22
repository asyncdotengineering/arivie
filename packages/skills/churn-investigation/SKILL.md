---
name: churn-investigation
description: Investigate WHY customers stopped purchasing/engaging. Compares the churned cohort against the retained cohort across dimensions (country, plan, signup_source, product_category) to surface which attributes correlate with churn.
when_to_use: |
  Load this skill when the user asks about:
    - "Why did X stop" / "why are we losing customers"
    - "Churn" / "churned" / "lapsed customers"
    - "What's different about customers who left vs stayed"
    - "Predict who's about to churn" (the diagnostic version — for predictive ML, route elsewhere)
  DON'T load for:
    - "How many churned" → that's `compile_metric` with a `churned` measure
    - Forward predictive scoring → out of scope for v0.2
inputs:
  - { name: churn_definition, type: string, default: "no completed_order in last 90 days", description: "What counts as 'churned'. Default is order-driven 90-day inactivity." }
  - { name: lookback, type: string, default: "180d", description: "How far back to look for the churned + retained cohorts" }
  - { name: dimensions, type: "string[]", default: ["country","plan","signup_source"], description: "Customer attributes to compare across" }
outputs:
  - { name: comparison_table, type: "row[]", description: "Per-dimension breakdown: { dimension_value, churned_pct_of_total, retained_pct_of_total, churn_lift }" }
  - { name: top_correlates, type: "string[]", description: "Top 3 attributes with highest churn_lift" }
sources:
  - postgres
---

# Churn-investigation playbook

This is a **diagnostic** skill — it doesn't predict who'll churn; it explains who already has.

## Phase 1 — Operationalise "churned"

`churn_definition` is a sentence; you need to convert it to SQL. Common shapes:

| User phrasing | SQL definition |
|---|---|
| "no completed order in last 90 days" | `MAX(o.created_at) FILTER (WHERE o.status='completed') < NOW() - INTERVAL '90 days'` |
| "subscription cancelled" | `customers.subscription_status = 'cancelled'` |
| "no page-view in 30 days" | (Mixpanel) `MAX(event_time WHERE event='Page Viewed') < NOW() - INTERVAL '30 days'` |

**State your definition in Assumptions** before any SQL. The user MUST be able to disagree.

## Phase 2 — Split the population into two cohorts

```sql
WITH customer_last_order AS (
  SELECT
    c.id AS customer_id,
    c.country,
    c.plan,                                              -- if customer has plan
    c.signup_source,                                     -- if customer has signup_source
    c.created_at AS signup_at,
    MAX(o.created_at) FILTER (WHERE o.status = 'completed') AS last_order_at
  FROM customers c
  LEFT JOIN orders o ON o.customer_id = c.id            -- LEFT — we want customers with zero orders
  WHERE c.created_at < NOW() - INTERVAL '{{lookback}}'  -- exclude too-new customers
  GROUP BY c.id, c.country, c.plan, c.signup_source, c.created_at
),
classified AS (
  SELECT
    *,
    CASE
      WHEN last_order_at IS NULL OR last_order_at < NOW() - INTERVAL '90 days'
        THEN 'churned'
      ELSE 'retained'
    END AS cohort
  FROM customer_last_order
)
SELECT cohort, COUNT(*) AS n FROM classified GROUP BY cohort;
```

Verify both cohorts have non-trivial size (≥ 30 each) before drilling in — small populations produce noise.

## Phase 3 — Per-dimension comparison

For each dimension in the `dimensions` input, compute the share of each cohort attributable to each dimension value, AND the **churn lift** = `churned_share / retained_share`:

```sql
WITH classified AS ( /* … from Phase 2 … */ ),
totals AS (
  SELECT
    cohort,
    COUNT(*) AS total
  FROM classified
  GROUP BY cohort
),
breakdown AS (
  SELECT
    cohort,
    country,
    COUNT(*) AS n
  FROM classified
  GROUP BY cohort, country
)
SELECT
  b.country AS dimension_value,
  ROUND(100.0 * b.n FILTER (WHERE b.cohort = 'churned')
        / (SELECT total FROM totals WHERE cohort = 'churned'), 1) AS churned_pct_of_total,
  ROUND(100.0 * b.n FILTER (WHERE b.cohort = 'retained')
        / (SELECT total FROM totals WHERE cohort = 'retained'), 1) AS retained_pct_of_total,
  ROUND(
    (b.n FILTER (WHERE b.cohort = 'churned') * (SELECT total FROM totals WHERE cohort = 'retained'))::numeric
    / NULLIF(b.n FILTER (WHERE b.cohort = 'retained') * (SELECT total FROM totals WHERE cohort = 'churned'), 0),
    2
  ) AS churn_lift
FROM breakdown b
GROUP BY b.country, b.n, b.cohort
ORDER BY churn_lift DESC NULLS LAST
LIMIT 20;
```

(Run this once per dimension. For 3 dimensions, that's 3 queries — well within the maxSteps=25 budget.)

## Phase 4 — Identify top correlates

Sort by `churn_lift`. **Lift > 1.3 = over-represented in churned cohort.** Surface the top 3.

Example output:
> "Churned customers are 2.4× over-represented in country=DE, 1.8× in plan=basic, 1.5× in signup_source=paid_search. Customers from the US and on the pro plan are over-represented in retained."

## Phase 5 — Statistical caveats

State these honestly in Assumptions — they're easy to over-claim:

- **Correlation ≠ causation.** Country=DE customers might churn more because they had a bad onboarding email translation, not because DE is intrinsically bad.
- **Small subgroups are noisy.** If a dimension value has < 30 customers in either cohort, **don't include it in top_correlates** — flag as "insufficient data."
- **Confounders.** If pro-plan customers all signed up before paid_search existed, signup_source = paid_search will spuriously correlate with churn. Mention if any of the dimensions are time-confounded.

## Phase 6 — Optional drill-in

After surfacing top correlates, OFFER to drill in (don't auto-drill; let the user choose). Example: "The top correlate is country=DE — want me to compare DE-churned customers' first-week behavior to DE-retained?"

## JOIN discipline reminder

The Phase 2 query uses `LEFT JOIN orders` because we want customers with **zero orders** (the deepest churn). INNER JOIN would silently exclude them. State the LEFT in Assumptions.

## Output format

- **Result:** one-paragraph headline naming top 3 correlates with their lifts.
- **Assumptions:** churn definition, lookback window, JOIN type, statistical caveats.
- **SQL:** Phase 2 + Phase 3 queries as separate ```sql fences.
- **Comparison table** rendered as markdown after the three sections.
