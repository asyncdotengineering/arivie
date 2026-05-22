---
name: end-of-day-close
description: Bookkeeper's end-of-day close packet. Per-outlet daily close — net sales by category, tender mix, processor fees, deposit envelope, GL summary. The exact format submitted to the accountant nightly.
when_to_use: |
  Load this skill when the user asks about:
    - "Daily close" / "End of day" / "EOD" / "Z-out"
    - "Close-out report" / "Nightly close packet"
    - "Submit to accountant" / "What does the bookkeeper need"
  DON'T load for:
    - Cash reconciliation specifically → use daily-z-out-reconciliation
    - Weekly P&L → use weekly-flash-report
audience_role: bookkeeper
cadence: daily
inputs:
  - { name: business_day, type: date, default: "current_business_day" }
  - { name: outlet_id, type: string, default: null, description: "NULL for chain-wide packet (one section per outlet)." }
outputs:
  - { name: close_packet, type: object, description: "Section per outlet: sales_summary, tender_mix, deposit, gl_summary" }
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


# End-of-day close packet

The bookkeeper's standard one-page-per-outlet packet. Same shape as Toast's "End of Day Report" / Square's "Daily Summary".

## Phase 1 — Sales summary by GL category

```ts
compile_metric({
  metric: "total_credits",
  segments: ["current_business_day"],
  dimensions: ["gl_entries.outlet_id", "gl_entries.account_code"],
})
```

Filter to account codes 4010 (food), 4020 (alcohol), 4030 (N/A bev). Report:
- Net food sales
- Net alcohol sales
- Net N/A beverage sales
- Less: comps (4900), voids (4910), discounts (4920)
- = **Net Sales**

## Phase 2 — Tender mix

```ts
compile_metric({
  metric: "tendered_amount",
  segments: ["current_business_day"],
  dimensions: ["tenders.outlet_id", "tenders.tender_type"],
})
```

Report cash, credit card (by brand), debit card, gift card, house account, 3PD remittances.

## Phase 3 — Processor fees

```ts
compile_metric({
  metric: "processor_fees",
  segments: ["current_business_day"],
  dimensions: ["tenders.outlet_id"],
})
```

Note these as a separate line — the bank deposit will be net of these.

## Phase 4 — Deposit envelope

```
deposit_envelope = cash_tendered
bank_deposit_credit = card_tendered + 3PD_tendered - processor_fees
```

Cash should physically match the deposit envelope counted at close. Card deposits land 1-3 days later; track expected vs actual via account 1030.

## Phase 5 — GL trial balance for the day

```ts
compile_metric({
  metric: "total_debits",
  segments: ["current_business_day"],
  dimensions: ["gl_entries.outlet_id", "gl_entries.account_code"],
})
compile_metric({
  metric: "total_credits",
  segments: ["current_business_day"],
  dimensions: ["gl_entries.outlet_id", "gl_entries.account_code"],
})
```

Confirm `SUM(debits) = SUM(credits)` per outlet per day. If not, the close is unbalanced — flag for the accountant.

## Phase 6 — Tax payable

```ts
compile_metric({
  metric: "total_credits",
  segments: ["current_business_day"],
  dimensions: ["gl_entries.outlet_id"],
})
```

Filter `account_code = '2100'` (Sales Tax Payable). Report the day's tax accrual.

## Output format (per outlet, one section)

```
─── <Outlet Name> — Business Day <YYYY-MM-DD> ──────────────────

  NET SALES
    Food                            $X,XXX.XX
    Alcohol                         $X,XXX.XX
    N/A Beverage                    $X,XXX.XX
    Less Comps                     ($X.XX)
    Less Voids                     ($X.XX)
    Less Discounts                 ($X.XX)
    ─────────────────────────────────────────
    NET SALES                       $X,XXX.XX

  TENDER MIX
    Cash                            $X,XXX.XX
    Card (Visa/MC/Amex/Disc)        $X,XXX.XX
    3PD Remittance (DD/UE/GH)       $X,XXX.XX
    Gift card / Other               $X.XX
    ─────────────────────────────────────────
    TOTAL TENDERED                  $X,XXX.XX

  Processor Fees                   ($X.XX)

  DEPOSIT ENVELOPE                  $X,XXX.XX  ← cash to bank
  Expected CC deposit               $X,XXX.XX  ← lands T+2

  GL CHECK: DR=$X,XXX.XX  CR=$X,XXX.XX  → BALANCED ✓ / OUT OF BALANCE ✗
  Tax payable accrued               $X,XXX.XX
```

## Self-correction

- **GL not balanced?** Either a posting failed or the close ran while a ticket was still open. Re-run the day's close job, or flag for accountant intervention.
- **Cash tender total ≠ deposit envelope counted?** Real shortage/overage. Surface the variance; do not silently absorb.
- **3PD remittance > food revenue?** Unlikely; check date filters — you may be summing un-remitted older orders.
- **Tax payable is 0?** All sales were comped/voided OR the tax rate is misconfigured.
