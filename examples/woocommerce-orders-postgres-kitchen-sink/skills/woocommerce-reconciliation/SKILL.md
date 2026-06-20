---
name: woocommerce-reconciliation
description: Finance reconciliation playbook for WooCommerce refunds, coupons, taxes, shipping, fees, payment methods, and raw JSON traceability.
license: Apache-2.0
---

## When to use

Use this skill for finance reconciliation, refund-adjusted revenue, coupon impact, tax collected, shipping fees, fee lines, payment method settlement, or audit traceability back to raw WooCommerce payloads.

## Rules

- Refund totals in WooCommerce order payloads are often negative. Report refund dollars as `ABS(total)` unless showing source sign.
- Coupon line discounts are positive discount amounts. They reduce revenue but should not be treated as negative facts in the coupon table.
- Tax, shipping, and fee lines are separate normalized tables. Use them instead of parsing raw JSON unless a plugin field is missing from normalized columns.
- Use raw JSONB only for traceability or plugin-specific fields not represented in normalized columns.
- Never join order totals to line items and sum without de-duplicating orders.
- For settlement-style reporting, group by `payment_method`, `date_paid`, and status.

## Suggested Flow

1. Pull order status and payment method totals from `wc_orders`.
2. Pull refunds from `wc_order_refunds` with `ABS(total)`.
3. Pull coupon impact from `wc_order_coupon_lines`.
4. Pull tax and shipping from `wc_order_taxes` and `wc_order_shipping_lines`.
5. Reconcile totals in a table and state remaining assumptions.
