---
type: playbook
title: Void and comp handling
description: Manager procedure for voids, comps, and KPI threshold escalation at Lumière Chain outlets.
refs:
  - semantic:tickets
  - semantic:tickets.void_pct
  - semantic:tickets.comp_pct
---
# Void and comp handling

Use this playbook when a GM asks about void/comp rates, closeout anomalies, or whether a ticket adjustment is within policy.

## Definitions

- **Void** — entire check cancelled before or after tender; value flows to `void_amount` and status becomes `voided`.
- **Comp** — manager-approved complimentary value on a closed check; flows to `comp_amount` while status stays `closed` or `comped`.

## KPI thresholds

| Metric | Target | Escalate when |
|--------|--------|---------------|
| `comp_pct` | < 3% of gross sales | ≥ 3% for any outlet over 7 days |
| `void_pct` | < 2% of gross sales | ≥ 2% for any outlet over 7 days |

Query `tickets.comp_pct` and `tickets.void_pct` grouped by `outlet_id` on `last_7_days` before drafting a brief.

## Closeout procedure

1. Pull yesterday's business day (`current_business_day` segment) void and comp totals per outlet.
2. Flag outlets breaching either threshold; note server_id on outlier tickets.
3. Require a manager note in the POS for any comp > $25 or void after tender.
4. Owner-facing recap uses **net revenue** (`tickets.revenue`), not gross sales — comps and voids are already netted out.

## Do not

- Exclude voided tickets from the `tickets` table — filter `status NOT IN ('voided')` for revenue only.
- Use `opened_at::date` for daily rollups; always prefer `business_day` (4am cutoff).