---
name: margin-watch
description: Weekly owner report for item mix, theoretical margin, 3PD delivery share, and revenue by concept.
license: Apache-2.0
---

## When to use

Use this skill for margin analysis, menu mix, owner weekly reports, theoretical margin, or delivery-channel profitability questions.

## Rules

- Use `ticket_items.theoretical_margin` for item-level margin.
- Use the `last_7_days` segment unless the user supplies a different window.
- Flag third-party delivery share if it exceeds 25% of revenue.
- Do not approximate ratios in prose; compute in SQL.

## Suggested output

- Top-line revenue by outlet.
- Top five menu items by theoretical margin.
- Delivery-channel warning if applicable.
- One recommendation for the GM or owner.
