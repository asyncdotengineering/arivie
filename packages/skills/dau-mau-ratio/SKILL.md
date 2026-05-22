---
name: dau-mau-ratio
description: Compute DAU/MAU (or WAU/MAU) stickiness ratio — what fraction of monthly users are active any given day. Standard product-engagement health metric; 20%+ = sticky, 50%+ = exceptional, < 10% = transactional.
when_to_use: |
  Load this skill when the user asks about:
    - "DAU / MAU / WAU" / "stickiness"
    - "Engagement ratio" / "active user ratio"
    - "How often do users come back"
    - "Are we transactional or sticky"
  DON'T load for:
    - Raw DAU/MAU counts without the ratio → `compile_metric` direct
    - Cohort-by-cohort engagement → use `cohort-analysis` skill
inputs:
  - { name: active_event, type: string, default: "any_order", description: "What counts as 'active' on a day. Default = any order; for engagement use a page-view / session event from Mixpanel." }
  - { name: window, type: integer, default: 90, description: "Number of days to compute the ratio over" }
  - { name: include_trend, type: boolean, default: true, description: "Also compute the ratio per day to show whether stickiness is rising/falling" }
outputs:
  - { name: ratio, type: number, description: "Average DAU / MAU across the window (0..1)" }
  - { name: trend, type: string, description: "'rising' / 'falling' / 'flat' based on linear regression of daily ratios" }
  - { name: interpretation, type: string, description: "Named tier: 'transactional' / 'engaged' / 'sticky' / 'exceptional'" }
sources:
  - postgres
  - mixpanel
---

# DAU/MAU playbook

This skill is intentionally simple — it answers a single well-defined question. Don't over-engineer.

## Phase 1 — Define "active"

The `active_event` input is the trickiest part. Common shapes:

| User phrasing | SQL definition |
|---|---|
| "any order" / "purchase" (default for e-commerce) | `SELECT DISTINCT customer_id, created_at::date FROM orders WHERE status NOT IN ('draft','cancelled')` |
| "completed order" | filter to `status = 'completed'` |
| "page view" (engagement) | Mixpanel query, distinct_id per day |
| "session" / "logged in" | depends on adapter; ask the user |

State your "active" definition in Assumptions.

## Phase 2 — Compute DAU + MAU per day

```sql
WITH active_user_days AS (
  SELECT DISTINCT
    o.customer_id AS user_id,
    o.created_at::date AS active_date
  FROM orders o
  WHERE o.status NOT IN ('draft', 'cancelled')         -- the {{active_event}}
    AND o.created_at >= NOW() - INTERVAL '{{window}} days'
),
per_day AS (
  SELECT
    aud.active_date,
    COUNT(DISTINCT aud.user_id) AS dau,
    -- MAU on a given date = distinct users active in the trailing 30 days
    (
      SELECT COUNT(DISTINCT inner_aud.user_id)
      FROM active_user_days inner_aud
      WHERE inner_aud.active_date BETWEEN aud.active_date - INTERVAL '29 days'
                                      AND aud.active_date
    ) AS mau
  FROM active_user_days aud
  GROUP BY aud.active_date
),
ratios AS (
  SELECT
    active_date,
    dau,
    mau,
    ROUND(100.0 * dau / NULLIF(mau, 0), 2) AS ratio_pct
  FROM per_day
)
SELECT * FROM ratios ORDER BY active_date;
```

The 30-day MAU subquery is the canonical definition. If your data warehouse has > 100M rows you'll want to materialize this; for sem-5 / dogfood scale, it runs in milliseconds.

## Phase 3 — Compute average + trend

After the per-day result lands, in the answer (no extra SQL needed):

```
average_ratio = mean of ratio_pct across the window
trend = linear-regress ratio_pct against day_index;
        slope > +0.05/day → rising
        slope < -0.05/day → falling
        otherwise → flat
```

You don't need a formal regression — eyeball the first-30-day-average vs the last-30-day-average. If they differ by > 2pp, name the trend.

## Phase 4 — Interpret the tier

| Average DAU/MAU | Tier | Common shape |
|---|---|---|
| < 10% | **transactional** | E-commerce, infrequent purchase; healthy if AOV is high |
| 10–20% | **engaged** | Mid-frequency apps (banking, news) |
| 20–50% | **sticky** | Daily-use apps (Slack, social) |
| 50%+ | **exceptional** | Power-user tools (IDE, terminal); rare for consumer apps |

State the tier explicitly. Don't say "20%" without naming it as `sticky`.

## Phase 5 — Cross-source variant

When `active_event` is a Mixpanel event:

1. Pull DAU from Mixpanel: `distinct_id` count per day for the event.
2. Pull MAU from Mixpanel: same event, 30-day distinct.
3. Or: pull all event records, materialize into a temp table in Postgres, run the same per_day SQL.

For sem-5 + Postgres-only, ignore this.

## Phase 6 — Self-correction

- **DAU > MAU on a single day**? Impossible (MAU is a superset). Bug in the subquery — the date range may be off.
- **Ratio is consistently 100%**? Either everyone is active every day (implausible for most products) OR your active-event filter is too broad / MAU window too short.
- **Ratio is 0 or NULL on weekends**? Healthy for B2B SaaS; suspect for e-commerce. Flag if user expected otherwise.

## JOIN discipline reminder

This skill doesn't join across entities by default — it's all in `orders` (or all in Mixpanel events). If the user wants DAU/MAU **per plan** or **per country**, you'll need to LEFT JOIN `customers` and group by the cohort dimension. State the JOIN type.

## Output format

- **Result:** "DAU/MAU averaged X% over the last {{window}} days — `{{tier}}`. Trend: {{trend}}."
- **Assumptions:** active-event definition, window, MAU's 30-day trailing definition.
- **SQL:** the WITH-CTE query.
- **Trend chart** as a sparkline-style markdown table if `include_trend` is true.
