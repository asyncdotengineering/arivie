---
name: daily-sales-recap
description: GM's morning report. Yesterday's revenue + cover count + avg check + comps/voids + top items, per outlet. The single brief a GM reads before the line opens.
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
  - "How did we do yesterday" / "Daily sales recap" / "Last night's numbers"
  - "Yesterday's revenue" / "What were yesterday's sales"
  - "Morning report" / "Open-the-restaurant report"
DON'T load for:
  - Multi-day trends → use weekly-flash-report
  - Live in-shift numbers → those need real-time queries, not this end-of-day skill


# Daily sales recap

The single page the GM reads with coffee. Comparable to Toast's "Daily Sales Summary" or Square's "End of Day".

## Phase 1 — Headline revenue + covers + avg check

```ts
compile_metric({
  metric: "revenue",
  segments: ["current_business_day"],
  dimensions: ["tickets.outlet_id"],
})
```

Then pull `ticket_count`, `covers`, `avg_check` as separate measures (one call each, same segment + dimension). Output the four-number headline.

## Phase 2 — Comp + void rates

```ts
compile_metric({ metric: "comp_pct", segments: ["current_business_day"], dimensions: ["tickets.outlet_id"] })
compile_metric({ metric: "void_pct", segments: ["current_business_day"], dimensions: ["tickets.outlet_id"] })
```

Flag any outlet with `comp_pct > 3` or `void_pct > 2` — those need a manager explanation.

## Phase 3 — Service-type mix

```ts
compile_metric({
  metric: "revenue",
  segments: ["current_business_day"],
  dimensions: ["tickets.outlet_id", "tickets.service_type"],
})
```

Surface dine-in vs takeout vs delivery vs bar revenue share. If 3PD share > 25% of revenue, flag it — marketplace fees eat margin.

## Phase 4 — Top 5 items by revenue (item velocity)

Use `execute` (custom SQL) because compile_metric on this shape returns too many rows:

```sql
SELECT mi.name, SUM(ti.qty) AS units, ROUND(SUM(ti.line_subtotal), 2) AS revenue
FROM ticket_items ti
JOIN tickets t ON t.id = ti.ticket_id
JOIN menu_items mi ON mi.id = ti.menu_item_id
WHERE NOT ti.is_voided
  AND t.business_day = (CURRENT_DATE - INTERVAL '1 day')::date
  AND (${outlet_id_filter})
GROUP BY mi.name
ORDER BY revenue DESC
LIMIT 5;
```

## Output format

- **Headline:** "<Outlet>: $<revenue> on <covers> covers across <tickets> tickets. Avg check $<X>."
- **Service mix:** "Dine-in <X>% / takeout <Y>% / delivery <Z>%."
- **Quality flags:** Comp <X>% (target <3%), void <Y>% (target <2%). Flag any breach.
- **Top sellers:** numbered list of 5 with units + revenue.
- **SQL:** the four queries inlined.

## Self-correction

- **Revenue is 0 across all outlets?** Either `business_day` boundary issue (check the 4am cutoff) or seed/data freshness.
- **Avg check is the same as gross sales / ticket count?** Voids weren't filtered. Confirm `status NOT IN ('voided')`.
- **Comp pct is 0% on an outlet that should have comps?** Comps may be recorded as discounts; check `discount_amount`.
