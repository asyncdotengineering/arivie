---
type: playbook
title: Refund window and issuance
description: Cash refund eligibility, store-credit alternative, and settlement timing for Lens & Luxe orders.
---
# Refund window and issuance

Use when the customer wants money back, asks how long refunds take, or disputes a partial credit.

## Cash refund eligibility

| Scenario | Window | How issued |
|----------|--------|------------|
| Undelivered / cancelled before ship | Any time before ship | Full `total` to original payment method |
| Return received (eligible per return-policy) | Within return window | `refunds.amount` to original card |
| Duplicate charge / our shipping error | No window limit | Full or partial per ops approval |
| Rx not tolerated (after remake exhausted) | Case-by-case | Cash or store credit — manager approval |

Query `refunds` bucketed by `refund_date` for period reporting; do not infer refund dollars from `orders.status` alone.

## Store credit vs cash

- **Store credit** — voucher on the customer account, never expires, usable on replacement frames or sun orders. Does not post to `refunds`; note in the care ticket only.
- **Cash refund** — posts to `refunds` with a `reason` code (`changed_mind`, `damaged_in_transit`, etc.).

Default to store credit when the customer is exchanging for a different frame SKU and the return is within policy. Default to cash when they explicitly want the original payment method or the order was our error.

## Timing

- **Card refunds:** 5–10 business days after warehouse processes the return (issuer-dependent).
- **PayPal / Shop Pay:** 3–5 business days.
- **Store credit:** issued same business day once the return is scanned in.

Set reply expectations from these ranges; do not quote same-day card settlement.

## Procedure

1. Confirm whether they want cash or account credit before initiating.
2. If cash, verify no existing `refunds` row for the same `order_id` unless partial line refund is intended.
3. Select the correct `reason` — drives ops reporting and CSQA.
4. Draft the reply with amount, method, and expected settlement window.