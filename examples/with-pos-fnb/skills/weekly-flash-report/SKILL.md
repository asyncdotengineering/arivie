---
name: weekly-flash-report
description: GM's Monday-morning weekly recap. 7-day revenue, prime-cost, labor %, comp/void trend, day-over-day vs prior week. The headline brief sent to ownership every Monday.
license: Apache-2.0
---

> ## Math discipline — read before doing anything else
>
> **Every arithmetic step in this report happens inside ONE SQL query (CTE-chained), not in your response text.**
>
> Do NOT compute variances, percentages, ratios, deltas, classifications, or aggregates by combining the outputs of multiple `compile_metric` calls. The model is unreliable at multi-step arithmetic; SQL is exact.
>
> Canonical pattern — one `execute_postgres` call returns the *final* shape:
> ```sql
> WITH a AS (-- pull raw inputs),
>      b AS (-- pull more raw inputs),
>      joined AS (
>        SELECT a.key,
>               a.x - b.y                              AS variance,
>               ROUND(100.0 * (a.x - b.y) / NULLIF(b.y, 0), 2) AS variance_pct,
>               CASE WHEN a.x > b.y THEN 'over' ELSE 'under' END AS classification
>        FROM a JOIN b USING (key)
>      )
> SELECT * FROM joined ORDER BY variance_pct DESC;
> ```
>
> **Banned in your reasoning trace:**
> - "Compute X = A - B"
> - "Divide A by B"
> - "The percentage is roughly..."
> - "I'll calculate the variance..."
>
> If a step truly cannot be expressed in SQL, STOP and surface that as a limitation — do not eyeball the math.


## When to use

Load this skill when the user asks about:
  - "Weekly flash" / "Weekly report" / "Monday recap"
  - "How did we do last week" / "This week vs last week"
  - "Weekly KPI dashboard" / "Weekly variance"
DON'T load for:
  - Single-day reporting → use daily-sales-recap
  - Pure cost-of-goods deep dive → use food-cost-variance


# Weekly flash report

The eight-line brief that lands in the GM's email Monday 7am. Comparable to Toast's "Weekly Performance".

## Phase 1 — ONE consolidated query

Revenue, ticket count, avg check, comp%, void%, COGS, labor, prime-cost%, WoW delta, and the flag column — all computed in SQL, all in one `execute_postgres` call.

```sql
WITH this_week AS (
  SELECT outlet_id,
         SUM(subtotal - discount_amount - comp_amount - void_amount)
           FILTER (WHERE status NOT IN ('voided')) AS revenue,
         COUNT(*) FILTER (WHERE status NOT IN ('voided'))               AS ticket_count,
         AVG(total_amount) FILTER (WHERE status NOT IN ('voided'))      AS avg_check,
         100.0 * SUM(comp_amount) / NULLIF(SUM(subtotal), 0)            AS comp_pct,
         100.0 * SUM(void_amount) / NULLIF(SUM(subtotal), 0)            AS void_pct
  FROM tickets
  WHERE business_day >= (CURRENT_DATE - INTERVAL '7 days')::date
    AND business_day <  CURRENT_DATE
  GROUP BY 1
),
prior_week AS (
  SELECT outlet_id,
         SUM(subtotal - discount_amount - comp_amount - void_amount)
           FILTER (WHERE status NOT IN ('voided')) AS revenue
  FROM tickets
  WHERE business_day >= (CURRENT_DATE - INTERVAL '14 days')::date
    AND business_day <  (CURRENT_DATE - INTERVAL '7 days')::date
  GROUP BY 1
),
costs AS (
  SELECT outlet_id,
         SUM(CASE WHEN account_code IN ('5010','5020','5030') THEN debit ELSE 0 END) AS cogs,
         SUM(CASE WHEN account_code IN ('6010','6020','6030') THEN debit ELSE 0 END) AS labor
  FROM gl_entries
  WHERE business_day >= (CURRENT_DATE - INTERVAL '7 days')::date
    AND business_day <  CURRENT_DATE
  GROUP BY 1
)
SELECT
  tw.outlet_id,
  ROUND(tw.revenue, 2)                                                 AS revenue_this_week,
  ROUND(pw.revenue, 2)                                                 AS revenue_prior_week,
  ROUND(100.0 * (tw.revenue - COALESCE(pw.revenue, 0))
        / NULLIF(pw.revenue, 0), 1)                                    AS wow_pct,
  tw.ticket_count,
  ROUND(tw.avg_check, 2)                                               AS avg_check,
  ROUND(tw.comp_pct, 2)                                                AS comp_pct,
  ROUND(tw.void_pct, 2)                                                AS void_pct,
  ROUND(c.cogs, 2)                                                     AS cogs,
  ROUND(c.labor, 2)                                                    AS labor,
  ROUND(100.0 * (c.cogs + c.labor) / NULLIF(tw.revenue, 0), 1)         AS prime_cost_pct,
  CASE
    WHEN tw.revenue < 0.9 * pw.revenue THEN 'revenue_dropped'
    WHEN 100.0 * (c.cogs + c.labor) / NULLIF(tw.revenue, 0) > 65 THEN 'prime_cost_high'
    WHEN tw.comp_pct > 3 THEN 'comp_high'
    WHEN tw.void_pct > 2 THEN 'void_high'
    ELSE 'ok'
  END                                                                  AS flag
FROM this_week tw
LEFT JOIN prior_week pw USING (outlet_id)
LEFT JOIN costs      c  USING (outlet_id)
ORDER BY revenue_this_week DESC;
```

The `flag` column already enumerates threshold breaches. Surface the rows; do not re-test thresholds in your response.

## Output format

- **Headline:** "Chain revenue $<X> (<±Y%> WoW). Prime cost <Z>%. Comp <A>%. Void <B>%."
- **By-outlet table** (markdown): outlet | revenue | wow_pct | prime_cost_pct | comp_pct | void_pct | flag
- **Flags:** mark any outlet where revenue WoW < -10% OR prime cost > 65% OR comp > 3% OR void > 2%.
- **Assumptions:** week = last 7 complete business days ending yesterday; prior_week = the 7 days before that.
- **SQL:** all queries inlined.

## Self-correction

- **WoW delta is +1000% on a single outlet?** Outlet was closed last week (no rows) — surface as "new this week" not as "massive growth."
- **Prime cost differs from prime-cost-recap skill?** Likely tax-treatment difference; cross-check labor split (FOH/BOH/Mgmt).
- **Sum of by-outlet revenue doesn't equal chain revenue?** Probably a NULL outlet_id row; investigate.
