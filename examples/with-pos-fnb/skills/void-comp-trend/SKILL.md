---
name: void-comp-trend
description: FOH Manager's loss-prevention scan. Daily void% and comp% trend over the last 14 days, by server. Surfaces servers whose comp/void rate is trending up — the leading indicator of either service issues or theft.
when_to_use: |
  Load this skill when the user asks about:
    - "Void rate" / "Comp rate" / "Comp trend"
    - "Are we comping more than usual"
    - "Loss prevention" / "Theft signal" / "Manager comp pattern"
  DON'T load for:
    - Headline daily comp/void → daily-sales-recap covers this
    - Single-server deep dive → use server-performance-scorecard
audience_role: foh_manager
cadence: daily (scan), weekly (deep)
inputs:
  - { name: outlet_id, type: string, required: true }
  - { name: window, type: string, default: "last_14_days" }
outputs:
  - { name: trend, type: "row[]", description: "{ business_day, server, comp_pct, void_pct, baseline_comp_pct, deviation }" }
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


# Void / comp trend

Loss prevention runs on this report. Industry rule of thumb:
- **Comp rate baseline:** 1-2% of gross sales. Above 3% = investigate. Above 5% = the server has authority they shouldn't, or there's a service quality crisis.
- **Void rate baseline:** <1% of gross sales. Above 2% = investigate. A pattern of voids by one server post-payment is the textbook theft signal.

## Phase 1 — 14-day daily comp/void % per outlet

```ts
compile_metric({
  metric: "comp_pct",
  segments: ["last_14_days"],
  dimensions: ["tickets.business_day", "tickets.outlet_id"],
})
compile_metric({
  metric: "void_pct",
  segments: ["last_14_days"],
  dimensions: ["tickets.business_day", "tickets.outlet_id"],
})
```

This gives a day-by-day trend line. Flag any day where either metric breaches its threshold.

## Phase 2 — Per-server breakdown for flagged days

For each flagged day, drill into:

```ts
compile_metric({
  metric: "comp_amount",
  segments: ["last_14_days"],
  dimensions: ["tickets.server_id", "tickets.business_day"],
})
compile_metric({
  metric: "void_amount",
  segments: ["last_14_days"],
  dimensions: ["tickets.server_id", "tickets.business_day"],
})
```

Surface the top 3 servers by `comp_amount` and by `void_amount`.

## Phase 3 — Comp/void reasons distribution

```sql
SELECT outlet_id, comp_reason, COUNT(*), ROUND(SUM(comp_amount), 2) AS total
FROM tickets
WHERE comp_amount > 0
  AND business_day >= (CURRENT_DATE - INTERVAL '14 days')::date
  AND business_day < CURRENT_DATE
GROUP BY 1, 2
ORDER BY total DESC;
```

If "manager comp - quality" dominates, kitchen has a quality problem. If "loyalty appreciation" dominates without a tracked loyalty program, it's a euphemism worth probing.

## Phase 4 — Compute deviation from outlet baseline

For each (server, day):
```
baseline_comp_pct  = AVG of all servers in that outlet, that day
deviation         = server_comp_pct - baseline_comp_pct
```

Flag any (server, day) where `deviation > 3 percentage points`.

## Output format

- **Headline:** "Outlet <X>: avg comp% <Y>, avg void% <Z> over last 14 days. <N> days breached comp threshold, <M> days breached void threshold."
- **Trend chart** as a text table: day | comp% | void% | flag
- **Top offenders:** numbered list — server name, day, comp$ or void$, deviation from baseline, action.
- **Reason breakdown:** top 5 comp_reason / void_reason buckets by dollar volume.

## Self-correction

- **Comp_pct is 100% on a single ticket?** A whole-table comp (e.g., a private dinner) — investigate but don't aggregate it into the per-server baseline.
- **Void rate spike on one day?** Check whether that day is the day a manager bulk-voids open-but-stale tickets at end of week. Distinct from in-shift voids.
- **Baseline is dragged up by one outlier server?** Use median rather than mean.
