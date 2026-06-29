---
type: reference
title: Revenue and discount definitions
description: Canonical Lumière Chain definitions for net revenue, gross sales, and pre-tax discounts.
refs:
  - semantic:tickets.revenue
  - semantic:tickets.gross_sales
  - semantic:tickets.discount_amount
---
# Revenue and discount definitions

These definitions govern owner reporting, flash reports, and any SQL the analyst agent compiles against the POS semantic layer.

## Net revenue (owner-facing)

**Net revenue** is the canonical top-line number for P&L and investor updates:

```
net_revenue = SUM(subtotal - discount_amount - comp_amount - void_amount)
              FILTER (WHERE status NOT IN ('voided'))
```

Mapped to `tickets.revenue`. Excludes tax and tip. This is the number in the weekly flash report and prime-cost denominator.

## Gross sales

**Gross sales** is pre-adjustment subtotal (`tickets.gross_sales`). Use for trend lines and comp/void percentage denominators only — not for accounting or owner summaries.

## Discounts

**Discounts** are pre-tax promotional reductions (`tickets.discount_amount`). Employee meals and manager comps are *not* discounts; they post to `comp_amount`.

## Tax and tips

- Sales tax: `tickets.tax_collected` — pass-through, not revenue.
- Tips: `tickets.tip_total` from tenders — excluded from net revenue; reconcile tip pools separately.

## Business day

Daily revenue groups on `business_day`, not calendar `opened_at`. The 4am cutoff is already applied in the warehouse; do not re-derive it in ad-hoc SQL.