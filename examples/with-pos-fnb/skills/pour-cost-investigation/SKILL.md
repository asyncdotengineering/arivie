---
name: pour-cost-investigation
description: Bar Manager's monthly pour-cost audit. Compares theoretical pour cost (recipe × cocktails sold) against actual liquor consumption from stock_movements. Industry healthy band 18-24%; above 28% is shrinkage, theft, or over-pouring.
when_to_use: |
  Load this skill when the user asks about:
    - "Pour cost" / "Liquor cost" / "Bar cost"
    - "Are we losing booze" / "Bar shrinkage"
    - "Over-pouring" / "Bar theft"
  DON'T load for:
    - Wine-bottle inventory only → query stock_movements directly
    - General food cost → use food-cost-variance
audience_role: bar_manager
cadence: weekly
inputs:
  - { name: outlet_id, type: string, required: true }
  - { name: window, type: string, default: "last_7_days" }
outputs:
  - { name: pour_cost_pct, type: numeric, description: "actual_liquor_cost / alcohol_revenue × 100" }
  - { name: variance_dollars, type: numeric }
sources:
  - postgres
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


# Pour-cost investigation

Pour cost = actual cost of liquor + beer + wine + mixers consumed, divided by alcohol revenue. The number every bar manager guards. Healthy band:
- **Spirits:** 18-22%
- **Wine:** 28-35%
- **Beer:** 22-28%
- **Blended bar:** 20-24% overall

Above the blended top-end consistently = over-pouring, free drinks given to friends, or back-door inventory walking out.

## Phase 1 — ONE consolidated query

Alcohol revenue, theoretical pour cost, actual pour cost (overall + by category), pour-cost%, variance, and verdict — all in a single SQL call.

```sql
WITH alcohol_revenue AS (
  SELECT t.outlet_id,
         SUM(ti.line_subtotal - ti.discount_amount - ti.comp_amount - ti.void_amount) AS revenue
  FROM ticket_items ti
  JOIN tickets    t  ON t.id  = ti.ticket_id
  JOIN menu_items mi ON mi.id = ti.menu_item_id
  WHERE NOT ti.is_voided AND NOT ti.is_comped
    AND mi.is_alcoholic = TRUE
    AND t.business_day >= (CURRENT_DATE - INTERVAL '7 days')::date
    AND t.business_day <  CURRENT_DATE
    AND t.outlet_id   = $1  -- bind outlet_id
  GROUP BY 1
),
theoretical_cost AS (
  SELECT t.outlet_id,
         SUM(ti.qty * mi.theoretical_food_cost) AS theoretical
  FROM ticket_items ti
  JOIN tickets    t  ON t.id  = ti.ticket_id
  JOIN menu_items mi ON mi.id = ti.menu_item_id
  WHERE NOT ti.is_voided
    AND mi.is_alcoholic = TRUE
    AND t.business_day >= (CURRENT_DATE - INTERVAL '7 days')::date
    AND t.business_day <  CURRENT_DATE
    AND t.outlet_id   = $1
  GROUP BY 1
),
actual_cost AS (
  SELECT sm.outlet_id, SUM(sm.qty * sm.unit_cost) AS actual
  FROM stock_movements sm
  JOIN ingredients i ON i.id = sm.ingredient_id
  WHERE sm.movement_type = 'consume'
    AND i.category IN ('beer','wine','spirit','liqueur','mixer')
    AND sm.occurred_at >= (CURRENT_DATE - INTERVAL '7 days')::date
    AND sm.occurred_at <  CURRENT_DATE
    AND sm.outlet_id  = $1
  GROUP BY 1
)
SELECT
  ar.outlet_id,
  ROUND(ar.revenue, 2)                                              AS alcohol_revenue,
  ROUND(t.theoretical, 2)                                           AS theoretical_cost,
  ROUND(a.actual, 2)                                                AS actual_cost,
  ROUND(100.0 * a.actual      / NULLIF(ar.revenue, 0), 2)           AS pour_cost_pct,
  ROUND(100.0 * t.theoretical / NULLIF(ar.revenue, 0), 2)           AS theoretical_pct,
  ROUND(100.0 * (a.actual - t.theoretical) / NULLIF(ar.revenue, 0), 2) AS variance_pp,
  CASE
    WHEN 100.0 * a.actual / NULLIF(ar.revenue, 0) <= 22 THEN 'tight'
    WHEN 100.0 * a.actual / NULLIF(ar.revenue, 0) <= 26 THEN 'healthy'
    WHEN 100.0 * a.actual / NULLIF(ar.revenue, 0) <= 28 THEN 'watch'
    ELSE 'investigate'
  END                                                                AS verdict
FROM alcohol_revenue ar
JOIN theoretical_cost t USING (outlet_id)
JOIN actual_cost      a USING (outlet_id);
```

## Phase 2 — Drill: actual cost by liquor category

```sql
SELECT i.category,
       ROUND(SUM(sm.qty * sm.unit_cost), 2) AS actual_cost
FROM stock_movements sm
JOIN ingredients i ON i.id = sm.ingredient_id
WHERE sm.movement_type = 'consume'
  AND i.category IN ('beer','wine','spirit','liqueur','mixer')
  AND sm.occurred_at >= (CURRENT_DATE - INTERVAL '7 days')::date
  AND sm.occurred_at <  CURRENT_DATE
  AND sm.outlet_id  = $1
GROUP BY 1
ORDER BY actual_cost DESC;
```

## Phase 5 — Interpret + drill

- **pour_cost_pct ≤ 22%** — tight bar. Praise.
- **22-26%** — within band, no action.
- **26-28%** — watch; spot-check measured pours over the next two shifts.
- **> 28%** — investigate. Subdivide by category: if spirits are the driver, over-pouring or freebies. If wine, comped-by-the-glass without ringing in. If beer, draft system tap setting.

## Output format

- **Result:** "Pour cost <X>% (theoretical <Y>%, variance <±Z>pp). <Verdict>."
- **By-category breakdown:** category | actual$ | theoretical$ | variance$ | variance%
- **Drill recommendations:** ordered list of which categories to spot-check next shift.
- **SQL:** all queries inlined.

## Self-correction

- **Pour cost > 100%?** Either alcohol revenue is being misclassified (food items flagged is_alcoholic=TRUE) or stock_movements include waste under 'consume' instead of 'waste'.
- **Theoretical = actual exactly?** Stock movements are auto-generated from tickets — your variance check has no signal. Wait for a physical count cycle to inject real `count_adjust` movements.
- **Variance is negative?** Bar is under-consuming vs recipe — likely a free-pour bartender measuring lighter than spec. Coach, don't celebrate.
