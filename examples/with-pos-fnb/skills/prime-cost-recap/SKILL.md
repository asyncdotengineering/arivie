---
name: prime-cost-recap
description: Owner-level prime-cost recap — food cost + labor cost as % of revenue, by outlet, with same-store comparison. The single most important F&B KPI the owner watches.
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
  - "Prime cost" / "prime cost percent" / "prime cost ratio"
  - "How healthy is the chain" / "Is the business making money"
  - "Food cost + labor cost combined" / "operating ratio"
Industry target: prime cost ≤ 60% of revenue (full-service); ≤ 55% (fast-casual).
Above 65% = the business is bleeding; act this week.
DON'T load for:
  - Just food cost (no labor) → use food-cost-variance
  - Just labor (no food) → query time_entries directly


# Prime-cost recap

The single number the owner cares about. Prime cost = (food + alcohol COGS) + (all labor) — expressed as a percent of revenue. Industry benchmark: ≤ 60% (full-service), ≤ 55% (fast-casual), ≤ 30% (bar).

## Phase 1 — ONE consolidated query

Run a single `execute_postgres` call. The CTE chain pulls revenue, COGS, and labor per outlet from the GL, then computes `prime_cost`, `prime_cost_pct`, and the verdict — all in SQL. Do not split this into three `compile_metric` calls; do not compute the ratio in your head.

```sql
WITH revenue AS (
  SELECT outlet_id,
         SUM(CASE WHEN account_code IN ('4010','4020','4030') THEN credit ELSE 0 END)
         - SUM(CASE WHEN account_code IN ('4900','4910','4920') THEN debit ELSE 0 END)
         AS revenue
  FROM gl_entries
  WHERE business_day >= (CURRENT_DATE - INTERVAL '7 days')::date
    AND business_day <  CURRENT_DATE
  GROUP BY 1
),
cogs AS (
  SELECT outlet_id, SUM(debit) AS cogs
  FROM gl_entries
  WHERE account_code IN ('5010','5020','5030')
    AND business_day >= (CURRENT_DATE - INTERVAL '7 days')::date
    AND business_day <  CURRENT_DATE
  GROUP BY 1
),
labor AS (
  SELECT outlet_id, SUM(debit) AS labor
  FROM gl_entries
  WHERE account_code IN ('6010','6020','6030')
    AND business_day >= (CURRENT_DATE - INTERVAL '7 days')::date
    AND business_day <  CURRENT_DATE
  GROUP BY 1
)
SELECT
  r.outlet_id,
  ROUND(r.revenue, 2)                                                AS revenue,
  ROUND(COALESCE(c.cogs,  0), 2)                                     AS cogs,
  ROUND(COALESCE(l.labor, 0), 2)                                     AS labor,
  ROUND(COALESCE(c.cogs, 0) + COALESCE(l.labor, 0), 2)               AS prime_cost,
  ROUND(100.0 * (COALESCE(c.cogs, 0) + COALESCE(l.labor, 0))
        / NULLIF(r.revenue, 0), 1)                                   AS prime_cost_pct,
  CASE
    WHEN 100.0 * (COALESCE(c.cogs, 0) + COALESCE(l.labor, 0)) / NULLIF(r.revenue, 0) <= 55 THEN 'excellent'
    WHEN 100.0 * (COALESCE(c.cogs, 0) + COALESCE(l.labor, 0)) / NULLIF(r.revenue, 0) <= 60 THEN 'healthy'
    WHEN 100.0 * (COALESCE(c.cogs, 0) + COALESCE(l.labor, 0)) / NULLIF(r.revenue, 0) <= 65 THEN 'watch'
    ELSE 'bleeding'
  END                                                                AS verdict
FROM revenue r
LEFT JOIN cogs  c USING (outlet_id)
LEFT JOIN labor l USING (outlet_id)
ORDER BY prime_cost_pct ASC;
```

The result already contains `verdict` per outlet. Surface the rows; do not re-classify in your response.

## Phase 2 — Chain headline (still one query)

Append a UNION ALL section to the same query, or run a second tiny query, to get chain-level prime cost:

```sql
SELECT
  ROUND(SUM(r.revenue), 2)                                            AS chain_revenue,
  ROUND(SUM(COALESCE(c.cogs, 0) + COALESCE(l.labor, 0)), 2)           AS chain_prime_cost,
  ROUND(100.0 * SUM(COALESCE(c.cogs, 0) + COALESCE(l.labor, 0))
        / NULLIF(SUM(r.revenue), 0), 1)                               AS chain_prime_cost_pct
FROM revenue r LEFT JOIN cogs c USING (outlet_id) LEFT JOIN labor l USING (outlet_id);
```

(Re-use the CTEs from Phase 1; emit as a single `execute_postgres` with both `SELECT`s, or fold both result sets into one chained query.)

## Output format

- **Result:** "$<chain_revenue> chain revenue this period; chain prime cost is <X>%. <Best outlet> leads at <Y>%; <Worst outlet> is at <Z>% — <verdict>."
- **By-outlet table** as markdown: outlet | revenue | cogs | labor | prime_cost_pct | verdict
- **Assumptions:** GL accounts used for each component; window resolved to <date_range>.
- **SQL:** the three queries inlined.

## Self-correction

- **Prime cost > 100%?** Either revenue includes voided/comped revenue (filter it out at semantic layer; the `revenue` measure already does), or labor is double-counted (FOH+BOH+Mgmt should not overlap).
- **A new outlet shows 80%?** New outlets ramp; flag it but don't sound alarms.
- **Labor is 0?** No shifts posted GL entries for the window — likely a closeout job failure, not real.
