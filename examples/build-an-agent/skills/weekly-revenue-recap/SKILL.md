---
name: weekly-revenue-recap
description: The Monday-morning revenue brief. Last 7 days vs the prior 7 — revenue, order count, average order value, refunds, and revenue by plan tier. One read before the week starts.
license: Apache-2.0
---

> ## Math discipline — read first
>
> **Every number in this brief comes from ONE SQL query, not from arithmetic in your reply.**
> Don't compute deltas or percentages by combining separate `compile_metric` calls — the model is unreliable at multi-step arithmetic; SQL is exact. Chain CTEs so a single `execute_postgres` call returns the final shape.

## What to produce

A short Markdown brief with:

1. **This week vs last week** — revenue, order count, average order value, with the week-over-week % change.
2. **Refunds** — refund amount and refunds as a share of revenue.
3. **Revenue by plan tier** — `free` / `pro` / `enterprise`.

## Canonical query shape

```sql
WITH this_week AS (
  SELECT SUM(amount_cents) FILTER (WHERE status = 'paid') / 100.0 AS revenue,
         COUNT(*)          FILTER (WHERE status = 'paid')         AS orders
  FROM orders
  WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'
),
last_week AS (
  SELECT SUM(amount_cents) FILTER (WHERE status = 'paid') / 100.0 AS revenue
  FROM orders
  WHERE created_at >= CURRENT_DATE - INTERVAL '14 days'
    AND created_at <  CURRENT_DATE - INTERVAL '7 days'
)
SELECT t.revenue,
       t.orders,
       ROUND(100.0 * (t.revenue - l.revenue) / NULLIF(l.revenue, 0), 1) AS revenue_wow_pct
FROM this_week t CROSS JOIN last_week l;
```

## Assumptions to state in the brief

- Revenue is **paid orders only**, excludes tax.
- Week = trailing 7 days from today.
- If a tier has zero orders this week, say so rather than omitting it.
