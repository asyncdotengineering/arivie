---
name: menu-engineering-matrix
description: Kasavana & Smith menu-engineering matrix. Classifies every menu item into star/plowhorse/puzzle/dog based on contribution margin × popularity. The chef + GM use this quarterly to decide which items to promote, re-price, re-cost, or cut.
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
  - "Menu engineering" / "Which menu items should we cut" / "Top performers"
  - "Star / plowhorse / puzzle / dog"
  - "Quarterly menu review" / "Menu mix analysis"
  - "What's selling and what's losing money"
DON'T load for:
  - Just unit velocity → simpler ticket_items query
  - Cost variance vs theoretical → use food-cost-variance


# Menu-engineering matrix

The Kasavana-Smith classification. Two axes:
- **Popularity** = item's share of total units sold vs the expected share if all items were equally popular. Above 70% of average = High; below = Low.
- **Contribution margin** = (list_price - theoretical_food_cost). Above category median = High; below = Low.

Four quadrants:
- **Star** = High popularity, High margin → keep, protect, feature
- **Plowhorse** = High popularity, Low margin → re-cost or re-portion
- **Puzzle** = Low popularity, High margin → reposition, market, describe better
- **Dog** = Low popularity, Low margin → cut from menu

## Phase 1 — Pull units sold + revenue per item

```sql
SELECT mi.id, mi.sku, mi.name, mc.course, mi.list_price, mi.theoretical_food_cost,
       SUM(ti.qty) AS units_sold,
       ROUND(SUM(ti.line_subtotal), 2) AS gross_revenue
FROM ticket_items ti
JOIN tickets t ON t.id = ti.ticket_id
JOIN menu_items mi ON mi.id = ti.menu_item_id
JOIN menu_categories mc ON mc.id = mi.category_id
WHERE NOT ti.is_voided
  AND t.business_day >= (CURRENT_DATE - INTERVAL '14 days')::date
  AND t.business_day < CURRENT_DATE
GROUP BY mi.id, mi.sku, mi.name, mc.course, mi.list_price, mi.theoretical_food_cost
ORDER BY units_sold DESC;
```

## Phase 2 — Compute per-item contribution margin

```
margin_per_unit = list_price - theoretical_food_cost
contribution    = margin_per_unit × units_sold
```

## Phase 3 — Compute popularity threshold

The standard convention:
```
expected_share = 100 / item_count
threshold      = expected_share × 0.70
popularity_pct = 100 × units_sold / SUM(units_sold across all items)
popularity_class = CASE WHEN popularity_pct >= threshold THEN 'High' ELSE 'Low' END
```

## Phase 4 — Compute margin threshold

The median `margin_per_unit` across the menu is the threshold:
```
margin_class = CASE WHEN margin_per_unit >= median THEN 'High' ELSE 'Low' END
```

## Phase 5 — Classify each item

| popularity_class | margin_class | classification |
|---|---|---|
| High | High | star      |
| High | Low  | plowhorse |
| Low  | High | puzzle    |
| Low  | Low  | dog       |

## Phase 6 — Cross-check against menu_items.menu_class

If `menu_class` in `menu_items` is already populated, compare the computed class against the stored one. Mismatches mean the stored class is stale and should be refreshed for the next menu print.

## Output format

- **Result:** "<N> stars (protect), <N> plowhorses (re-cost), <N> puzzles (reposition), <N> dogs (cut). Top star: <name>. Worst dog: <name>."
- **Action list:** ordered list of concrete recommendations:
  1. Cut: <dog items by name>
  2. Re-cost or re-portion: <plowhorse items>
  3. Reposition / market: <puzzle items>
  4. Protect / feature on menu: <star items>
- **Matrix table:** item | units | popularity% | margin$ | margin_class | popularity_class | classification | stored_class | drift?

## Self-correction

- **Every item is a star?** Threshold too low — popularity_class HIGH for everything. Recompute with the 0.70-of-average rule, not 0.50.
- **No dogs?** Either you've already cut them historically (good), or the 14-day window is too short to surface low-velocity items. Try last 30 days.
- **A new item shows as dog?** New items need a 30-day grace period before classification means anything.
