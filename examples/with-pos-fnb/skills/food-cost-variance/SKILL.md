---
name: food-cost-variance
description: Executive Chef's weekly food-cost audit. Compares theoretical food cost (recipe × units sold) against actual food cost (consume + waste movements). Surfaces the variance that signals theft, portion drift, or recipe error.
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
  - "Food cost variance" / "Theoretical vs actual food cost"
  - "Why is food cost up" / "Is the kitchen over-portioning"
  - "Are we wasting more food"
  - "Recipe vs reality"
DON'T load for:
  - Just headline food cost % → query stock_movements.actual_consumption_cost directly
  - Pour cost (bar) → use pour-cost-investigation


# Food-cost variance

The chef's "did we run a tight kitchen this week" report. Theoretical = what we should have used per recipe. Actual = what stock_movements says we did use. The variance is either over-portioning, waste under-reported, or theft.

## Phase 1 — ONE consolidated query

Theoretical, actual, waste, food revenue, variance, and verdict — all in a single SQL. Do not split into three `compile_metric` calls; do not eyeball the variance afterwards.

```sql
WITH theoretical AS (
  SELECT t.outlet_id,
         SUM(ti.qty * mi.theoretical_food_cost) AS theoretical_cost
  FROM ticket_items ti
  JOIN tickets    t  ON t.id = ti.ticket_id
  JOIN menu_items mi ON mi.id = ti.menu_item_id
  WHERE NOT ti.is_voided
    AND mi.is_alcoholic = FALSE
    AND t.business_day >= (CURRENT_DATE - INTERVAL '7 days')::date
    AND t.business_day <  CURRENT_DATE
  GROUP BY 1
),
actual AS (
  SELECT sm.outlet_id,
         SUM(sm.qty * sm.unit_cost) AS actual_cost
  FROM stock_movements sm
  JOIN ingredients i ON i.id = sm.ingredient_id
  WHERE sm.movement_type = 'consume'
    AND i.category IN ('protein','produce','dairy','dry','frozen','beverage_na')
    AND sm.occurred_at >= (CURRENT_DATE - INTERVAL '7 days')::date
    AND sm.occurred_at <  CURRENT_DATE
  GROUP BY 1
),
waste AS (
  SELECT sm.outlet_id, SUM(sm.qty * sm.unit_cost) AS waste_cost
  FROM stock_movements sm
  WHERE sm.movement_type = 'waste'
    AND sm.occurred_at >= (CURRENT_DATE - INTERVAL '7 days')::date
    AND sm.occurred_at <  CURRENT_DATE
  GROUP BY 1
),
food_revenue AS (
  SELECT outlet_id, SUM(credit) AS food_revenue
  FROM gl_entries
  WHERE account_code = '4010'
    AND business_day >= (CURRENT_DATE - INTERVAL '7 days')::date
    AND business_day <  CURRENT_DATE
  GROUP BY 1
)
SELECT
  COALESCE(t.outlet_id, a.outlet_id, w.outlet_id, fr.outlet_id) AS outlet_id,
  ROUND(COALESCE(t.theoretical_cost, 0), 2)                    AS theoretical_cost,
  ROUND(COALESCE(a.actual_cost,      0), 2)                    AS actual_cost,
  ROUND(COALESCE(w.waste_cost,       0), 2)                    AS waste_cost,
  ROUND(COALESCE(fr.food_revenue,    0), 2)                    AS food_revenue,
  ROUND(COALESCE(a.actual_cost, 0) - COALESCE(t.theoretical_cost, 0), 2) AS variance_dollars,
  ROUND(100.0 * (COALESCE(a.actual_cost, 0) - COALESCE(t.theoretical_cost, 0))
        / NULLIF(fr.food_revenue, 0), 2)                       AS variance_pct,
  CASE
    WHEN 100.0 * (COALESCE(a.actual_cost, 0) - COALESCE(t.theoretical_cost, 0))
         / NULLIF(fr.food_revenue, 0) < 0 THEN 'under_portioning'
    WHEN 100.0 * (COALESCE(a.actual_cost, 0) - COALESCE(t.theoretical_cost, 0))
         / NULLIF(fr.food_revenue, 0) <= 2 THEN 'healthy'
    WHEN 100.0 * (COALESCE(a.actual_cost, 0) - COALESCE(t.theoretical_cost, 0))
         / NULLIF(fr.food_revenue, 0) <= 4 THEN 'investigate'
    ELSE 'material_leak'
  END                                                          AS verdict
FROM           theoretical t
FULL OUTER JOIN actual       a  ON a.outlet_id  = t.outlet_id
FULL OUTER JOIN waste        w  ON w.outlet_id  = COALESCE(t.outlet_id, a.outlet_id)
FULL OUTER JOIN food_revenue fr ON fr.outlet_id = COALESCE(t.outlet_id, a.outlet_id, w.outlet_id)
ORDER BY variance_pct DESC NULLS LAST;
```

The result already classifies every outlet. Surface the rows; do not re-derive the variance.

## Phase 2 — Drill: top wasted ingredients per outlet

Optional, single query:

```sql
SELECT sm.outlet_id, i.name AS ingredient,
       ROUND(SUM(sm.qty * sm.unit_cost), 2) AS waste_cost
FROM stock_movements sm
JOIN ingredients i ON i.id = sm.ingredient_id
WHERE sm.movement_type = 'waste'
  AND sm.occurred_at >= (CURRENT_DATE - INTERVAL '7 days')::date
  AND sm.occurred_at <  CURRENT_DATE
GROUP BY 1, 2
ORDER BY waste_cost DESC
LIMIT 5;
```

## Phase 3 — Interpret (verdict already in query result)

- **variance_pct < 0** — actual was below theoretical. Either chef is under-portioning (guest complaints upcoming) or recipe over-states cost. Worth a recipe-cost-card refresh.
- **0% ≤ variance_pct ≤ 2%** — healthy variance band. Normal noise.
- **2% < variance_pct ≤ 4%** — investigate. Likely portion drift or unreported waste.
- **variance_pct > 4%** — material. Could be theft, recipe error, or systemic over-portioning. Walk-through the line tomorrow.

## Output format

- **Result:** "Theoretical food cost $<T>; actual $<A>; variance $<V> (<±X>% of food revenue). <Verdict>."
- **By-outlet table:** outlet | theoretical | actual | waste | variance$ | variance% | verdict
- **Top wasted ingredients** (markdown sub-list): show the top 5 by `waste_cost` so the chef knows where to act.
- **SQL:** all queries inlined.

## Self-correction

- **Actual is exactly equal to theoretical?** Stock movements are being generated from recipes, not from independent counts. The variance check is meaningless until physical inventory counts populate `count_adjust` movements.
- **Variance is hugely negative?** Some `consume` rows may be missing. Check that every non-voided ticket_item generated stock_movements rows.
- **Waste cost > variance?** Waste is already in `actual_consumption_cost` — make sure your custom SQL doesn't double-count by filtering movement_type='consume' (waste rows have movement_type='waste').
