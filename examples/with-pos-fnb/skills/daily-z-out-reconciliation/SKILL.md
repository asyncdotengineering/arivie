---
name: daily-z-out-reconciliation
description: Bookkeeper's Z-out reconciliation. Cross-checks ticket totals against tender totals against GL totals — three independent sources of the same number. Any mismatch is a posting error that must be resolved before the close stands.
when_to_use: |
  Load this skill when the user asks about:
    - "Z-out" / "Reconcile" / "Tender reconciliation"
    - "Why doesn't the cash match" / "Find the discrepancy"
    - "Three-way reconciliation"
  DON'T load for:
    - The close-packet format → use end-of-day-close
    - Card processor disputes → out of scope
audience_role: bookkeeper
cadence: daily
inputs:
  - { name: business_day, type: date, default: "current_business_day" }
  - { name: outlet_id, type: string, required: true }
outputs:
  - { name: tickets_total, type: numeric }
  - { name: tenders_total, type: numeric }
  - { name: gl_total, type: numeric }
  - { name: variance, type: numeric, description: "Should be 0; flag any non-zero." }
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


# Daily Z-out reconciliation

Three-way tie-out: tickets ↔ tenders ↔ GL. All three should agree to the penny.

## Phase 1 — ONE consolidated query

All three totals + all three pairwise variances + reconciliation status — single SQL call.

```sql
WITH tickets_side AS (
  SELECT outlet_id, ROUND(SUM(total_amount), 2) AS tickets_total
  FROM tickets
  WHERE business_day = (CURRENT_DATE - INTERVAL '1 day')::date
    AND status NOT IN ('voided')
  GROUP BY 1
),
tenders_side AS (
  SELECT outlet_id, ROUND(SUM(amount), 2) AS tenders_total
  FROM tenders
  WHERE captured_at >= (CURRENT_DATE - INTERVAL '1 day')::date
    AND captured_at <  CURRENT_DATE
  GROUP BY 1
),
gl_side AS (
  SELECT outlet_id,
         ROUND(
           SUM(CASE WHEN account_code IN ('4010','4020','4030') THEN credit ELSE 0 END)
           - SUM(CASE WHEN account_code IN ('4900','4910','4920') THEN debit ELSE 0 END)
           + SUM(CASE WHEN account_code = '2100' THEN credit ELSE 0 END)
           + SUM(CASE WHEN account_code = '2200' THEN credit ELSE 0 END),
           2) AS gl_total
  FROM gl_entries
  WHERE business_day = (CURRENT_DATE - INTERVAL '1 day')::date
  GROUP BY 1
)
SELECT
  COALESCE(tk.outlet_id, tn.outlet_id, gl.outlet_id)    AS outlet_id,
  tk.tickets_total,
  tn.tenders_total,
  gl.gl_total,
  ROUND(tk.tickets_total - tn.tenders_total, 2)         AS tickets_vs_tenders,
  ROUND(tk.tickets_total - gl.gl_total,      2)         AS tickets_vs_gl,
  ROUND(tn.tenders_total - gl.gl_total,      2)         AS tenders_vs_gl,
  CASE
    WHEN ABS(tk.tickets_total - tn.tenders_total) < 1
     AND ABS(tk.tickets_total - gl.gl_total)      < 1
     AND ABS(tn.tenders_total - gl.gl_total)      < 1
    THEN 'RECONCILED'
    ELSE 'VARIANCE_DETECTED'
  END                                                   AS status
FROM      tickets_side tk
FULL JOIN tenders_side tn USING (outlet_id)
FULL JOIN gl_side      gl USING (outlet_id)
ORDER BY outlet_id;
```

All three variances appear as columns. Status is computed in SQL — do not re-evaluate the threshold yourself.

## Phase 5 — Drill on the mismatch

If `tickets_vs_tenders ≠ 0`:
- A ticket closed without a tender, OR
- A tender was recorded against a non-existent ticket, OR
- Split-check rounding leaked.

Query the tickets-without-tenders:
```sql
SELECT t.id, t.total_amount, t.status
FROM tickets t
LEFT JOIN tenders tn ON t.id = tn.ticket_id
WHERE t.business_day = (CURRENT_DATE - INTERVAL '1 day')::date
  AND t.status NOT IN ('voided')
  AND tn.id IS NULL;
```

If `tickets_vs_gl ≠ 0`:
- A daily close job didn't run for this outlet, OR
- Some tickets posted to a different business_day in the GL (timezone drift), OR
- An adjustment was made to tickets after close.

## Output format

```
─── Z-out Reconciliation: <Outlet> — <YYYY-MM-DD> ───

  Tickets total              $X,XXX.XX
  Tenders total              $X,XXX.XX
  GL total                   $X,XXX.XX

  Tickets ↔ Tenders           $0.00  ✓
  Tickets ↔ GL                $0.00  ✓
  Tenders ↔ GL                $0.00  ✓

  STATUS: RECONCILED ✓

  -- OR --

  STATUS: VARIANCE DETECTED ✗
  Drill list: <ticket_ids_with_issues>
```

## Self-correction

- **All three totals are 0?** Either the date filter misses everything (4am cutoff) or this outlet didn't trade. Confirm before raising alarm.
- **Variance is exactly tax_amount?** GL formula is summing without tax — check the SQL.
- **Tickets total > tenders total?** Tickets were closed without tendering (house-account or comp issue). Investigate the un-tendered tickets list.
