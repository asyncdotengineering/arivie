---
name: cohort-analysis
description: Compute cohort retention curves by signup-period (week/month/quarter), comparing N cohorts side by side. Surfaces the retention triangle + the named trend (decay rate, cliff months, cohort comparisons).
license: Apache-2.0
---

## When to use

Load this skill when the user asks about:
  - "Retention" / "retained" / "still active" over time
  - "Cohort" / "cohort analysis" / "by signup month"
  - "How do users from March compare to April"
  - "When do users drop off"
  - "Is our retention curve flattening"
DON'T load for:
  - Single-period counts ("how many active users last month") → use `compile_metric` + a `monthly_active` measure
  - Single user lookups → use `execute`


# Cohort analysis playbook

The agent reads this when invoked. The plan is non-negotiable structure; the SQL templates are the canonical query shape.

## Phase 1 — Identify the cohort dimension

1. The cohort is bucketed by **first activation date** — usually `customers.created_at` for SaaS or `orders.created_at` filtered to first order per customer for e-commerce. Confirm which the user means.
2. Resolve `cohort_grain`: `month` → `date_trunc('month', created_at)`, `week` → `date_trunc('week', created_at)`, `quarter` → `date_trunc('quarter', created_at)`.
3. Resolve `retention_event`: must map to either a measure declared in the semantic layer (e.g. `orders.revenue` filtered to completed) OR an event source (Mixpanel/PostHog if available).

State your cohort definition in **Assumptions** before running SQL. The user MUST be able to read your assumption and disagree.

## Phase 2 — Pull cohort populations + retained-by-period counts

Use `compile_metric` when the metric is declared, otherwise `execute`. Cohort SQL is rarely covered by a single declared measure — fall back to `execute`.

### Canonical SQL template (Postgres-native)

```sql
WITH cohorts AS (
  SELECT
    c.id AS customer_id,
    date_trunc({{cohort_grain}}, c.created_at)::date AS cohort_period
  FROM customers c
  WHERE c.created_at >= date_trunc({{cohort_grain}}, CURRENT_DATE) - INTERVAL '{{months_back}} months'
),
retained AS (
  -- For order-driven retention: a completed order in the period offset
  SELECT
    co.cohort_period,
    co.customer_id,
    (date_trunc({{cohort_grain}}, o.created_at)::date
      - co.cohort_period) / INTERVAL '1 {{cohort_grain}}' AS period_offset
  FROM cohorts co
  JOIN orders o ON o.customer_id = co.customer_id
  WHERE o.status = 'completed'                                -- ← the retention_event
    AND o.created_at >= co.cohort_period
),
sized AS (
  SELECT
    cohort_period,
    COUNT(DISTINCT customer_id) AS cohort_size
  FROM cohorts
  GROUP BY cohort_period
)
SELECT
  s.cohort_period,
  s.cohort_size,
  r.period_offset,
  COUNT(DISTINCT r.customer_id) AS retained_users,
  ROUND(100.0 * COUNT(DISTINCT r.customer_id) / NULLIF(s.cohort_size, 0), 1) AS retention_pct
FROM sized s
LEFT JOIN retained r ON r.cohort_period = s.cohort_period
WHERE r.period_offset BETWEEN 0 AND {{max_period_offset}}
GROUP BY s.cohort_period, s.cohort_size, r.period_offset
ORDER BY s.cohort_period DESC, r.period_offset ASC;
```

## Phase 3 — Pivot into a triangle

The raw result is one row per (cohort, period_offset). Pivot to a triangle for the user:

```
                    Period offset
cohort_period   M0     M1     M2     M3     M4     M5
2026-04-01     100%   62%    51%    44%    -      -
2026-03-01     100%   58%    47%    40%    36%    -
2026-02-01     100%   61%    49%    42%    37%    34%
...
```

Compute this in SQL (PIVOT) or in the answer markdown — markdown is fine for ≤ 6 cohorts × 6 periods.

## Phase 4 — Name the trend

After computing the triangle, identify ONE of these named trends and state it in `Result`:

- **`flat`** — period-N retention varies < 5 percentage points across cohorts. "Retention is stable."
- **`decaying`** — recent cohorts show worse period-N retention than older ones by ≥ 5pp. "Retention is decaying — May cohort at month 3 = 41% vs Feb cohort at month 3 = 58%."
- **`improving_over_cohorts`** — recent cohorts show better period-N retention than older ones by ≥ 5pp.
- **`cliff_at_month_N`** — sharp drop between period N-1 and N (≥ 15pp drop). "Users churn at month 3 — every cohort drops from ~55% to ~30% there."

## Phase 5 — Self-correction

- **Zero retained users** for a cohort? Verify the retention_event filter — is `status = 'completed'` excluding too much? Try a broader event (any order, not just completed) and state it in Assumptions.
- **Cohort size = 0**? `months_back` may be reaching before the first customer's `created_at`. Narrow the range.
- **Negative `period_offset`**? Bug in your interval arithmetic. The HAVING clause `period_offset >= 0` belongs in the CTE.

## JOIN discipline reminder

`LEFT JOIN retained` — INNER would drop cohort-periods with zero retained users, hiding the worst cohorts. **State the LEFT JOIN choice in Assumptions.**

## Output format

Per Arivie's OUTPUT_FORMAT_RULE — three labelled sections:

- **Result:** one-sentence headline ("Retention is stable around 50% at month 3 across the last 6 monthly cohorts.")
- **Assumptions:** cohort grain, retention event definition, time window, JOIN type.
- **SQL:** the WITH-CTE query verbatim inside a ```sql fence.

Optionally include the triangle as a markdown table after the three sections.

## References

- [Mixpanel: cohort analysis](references/mixpanel-cohort-analysis-notes.md) (when retention_event = a Mixpanel event)
- Arivie docs: `concepts/the-agent-loop` for how skills compose with `compile_metric`.
