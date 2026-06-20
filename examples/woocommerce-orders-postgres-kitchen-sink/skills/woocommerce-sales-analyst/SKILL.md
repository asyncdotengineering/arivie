---
name: woocommerce-sales-analyst
description: Senior WooCommerce store analytics playbook for revenue, products, variants, customers, countries, payment methods, and order status trends.
license: Apache-2.0
---

## When to use

Use this skill when the merchant asks about sales, product performance, variant performance, AOV, repeat customers, geographies, payment methods, or order status trends.

## Rules

- Use `wc_orders` for order-level metrics such as AOV, payment methods, status trends, countries, tax, shipping, and order totals.
- Use `wc_order_line_items` for product-level and variant-level revenue. Do not rank products by joined `wc_orders.total`.
- Use completed and processing orders for current sales unless the user explicitly asks for all statuses.
- Treat `variation_id` as the WooCommerce variant key when present. `variation_id IS NULL` means simple/non-variant product revenue.
- Always disclose whether revenue includes tax, shipping, discounts, and refunds.
- Use `compile_metric` for canonical measures when possible.
- Preserve the distinction between gross sales, net sales, and refund-adjusted revenue.

## Suggested Flow

1. Identify the grain: order, line item, customer, coupon, refund, tax, or shipping.
2. Select the canonical measure from the semantic layer before writing SQL.
3. For product questions, group by `product_id`, `variation_id`, `sku`, and product name.
4. For simple-vs-variant questions, group by `wc_order_line_items.product_type`.
5. Return concise business interpretation plus the exact metric definition used.
