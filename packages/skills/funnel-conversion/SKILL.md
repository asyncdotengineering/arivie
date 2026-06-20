---
name: funnel-conversion
description: Compute step-by-step funnel conversion rates between N events (visit → signup → first order → repeat purchase), surface absolute drop-offs and per-step conversion percentages, and name the bottleneck step.
license: Apache-2.0
---

## When to use

Load this skill when the user asks about:
  - "Funnel" / "conversion rate" / "drop-off"
  - "Where do users abandon" / "how many make it from X to Y"
  - "Step-by-step from <event_a> to <event_b>"
  - "What's our checkout completion rate"
DON'T load for:
  - Single-step counts → use `compile_metric` or `execute`
  - Time-series trends of one funnel rate → use this skill for one snapshot, then ask the user if they want it as a trend (next skill: `metric-over-time`)


# Funnel-conversion playbook

## Phase 1 — Resolve each step to a query

The user gives you ordered step names. For each step, find the corresponding semantic-layer entity OR event source:

| Step shape | Where it lives | How to count |
|---|---|---|
| `"signup"` | `customers.created_at` exists | `COUNT(DISTINCT c.id) WHERE created_at IN window` |
| `"first_order"` | `orders.id` exists, qualified to a customer's first | `COUNT(DISTINCT customer_id)` with `ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY created_at) = 1` |
| `"page_view"` / `"button_click"` | Mixpanel/PostHog if configured | Event-source query (see §Cross-source below) |
| `"completed_order"` | `orders.status = 'completed'` | filtered measure |

State the mapping in Assumptions. If a step doesn't map cleanly, **stop and ask the user to clarify** before guessing.

## Phase 2 — Build the per-step SQL

For the Postgres-only case (signup → first order → repeat purchase):

```sql
WITH
step_1 AS (
  -- signup
  SELECT
    c.id AS customer_id,
    c.created_at AS step_at,
    1 AS step_index
  FROM customers c
  WHERE c.created_at >= NOW() - INTERVAL '90 days'        -- cohort window — adjust per question
  {{cohort_filter_clause}}
),
step_2 AS (
  -- first_order within {{window}} of signup
  SELECT
    s1.customer_id,
    MIN(o.created_at) AS step_at,
    2 AS step_index
  FROM step_1 s1
  JOIN orders o ON o.customer_id = s1.customer_id
  WHERE o.created_at BETWEEN s1.step_at AND s1.step_at + INTERVAL '{{window}}'
  GROUP BY s1.customer_id
),
step_3 AS (
  -- repeat_purchase: 2nd completed order within {{window}} of first
  SELECT
    s2.customer_id,
    MIN(o.created_at) AS step_at,
    3 AS step_index
  FROM step_2 s2
  JOIN orders o ON o.customer_id = s2.customer_id
  WHERE o.status = 'completed'
    AND o.created_at > s2.step_at
    AND o.created_at <= s2.step_at + INTERVAL '{{window}}'
  GROUP BY s2.customer_id
),
combined AS (
  SELECT * FROM step_1
  UNION ALL SELECT * FROM step_2
  UNION ALL SELECT * FROM step_3
)
SELECT
  step_index,
  CASE step_index WHEN 1 THEN 'signup'
                  WHEN 2 THEN 'first_order'
                  WHEN 3 THEN 'repeat_purchase' END AS step_name,
  COUNT(DISTINCT customer_id) AS users_reaching
FROM combined
GROUP BY step_index
ORDER BY step_index;
```

## Phase 3 — Compute conversion metrics

In the answer (markdown table — don't burn another DB roundtrip on this):

| step | users_reaching | abs_dropoff | conv_pct_from_prev | conv_pct_from_top |
|---|---|---|---|---|
| signup | 1,000 | — | — | 100.0% |
| first_order | 240 | 760 | 24.0% | 24.0% |
| repeat_purchase | 84 | 156 | 35.0% | 8.4% |

## Phase 4 — Identify the bottleneck

The bottleneck is the step with the **worst `conv_pct_from_prev`**. State it in Result:
> "The biggest drop is signup → first_order: 76% of new signups never place an order within 30 days. Repeat-purchase conversion among customers who placed a first order is healthy (35%)."

## Phase 5 — Self-correction

- **Step 2 reaching ≥ step 1**? Window leak — your `BETWEEN` is wrong, or a customer placed an order BEFORE signing up (data quality). Investigate.
- **A step shows 0 users**? Verify the event/condition exists at all. Run `SELECT COUNT(*) FROM <table> WHERE <step_condition>` standalone before assuming the funnel is broken.
- **Bottleneck looks too clean (90%+ drop)** — sanity-check the window. A `repeat_purchase` window of "30 days from first order" is reasonable; "30 days from signup" is too tight.

## Cross-source (Postgres + Mixpanel)

When step 1 is a Mixpanel `Page Viewed` and step 2 is Postgres `signup`:

1. Pull step 1 from Mixpanel: distinct `distinct_id` who fired the event in the window.
2. Pull step 2 from Postgres: `customers.created_at` in same window.
3. Join on the linking key (`customers.mixpanel_distinct_id` if present, else hash-join on email).
4. Hard cap result row count at 10,000 — client-side joins die on cardinality.

If the join key isn't declared in the semantic layer's `joins[]` (cross-source), **stop and ask the user** rather than guess.

## JOIN discipline reminder

Step CTEs above use INNER JOIN intentionally — we WANT users to drop out of the funnel. State that in Assumptions ("INNER JOINs between step CTEs are intentional — users who don't reach a step are excluded from that step's count.").

## Output format

- **Result:** one-sentence headline naming the bottleneck step.
- **Assumptions:** step→data mappings, window, cohort filter, join semantics.
- **SQL:** the WITH-CTE block.
- **Funnel table** rendered as markdown after the three sections.
