---
type: reference
usage_mode: always
title: Care definitions glossary
description: Canonical Lens & Luxe definitions for refund, store credit, remake, defective, and buyer's remorse — resolves ambiguous glossary terms.
refs:
  - semantic:refunds
  - semantic:refunds.amount
  - semantic:remakes
  - semantic:orders
  - semantic:orders.net_revenue
---
# Care definitions glossary

These definitions govern customer-care drafts and any analytics the agent compiles against the eyewear semantic layer. They resolve ambiguous terms in `semantic/glossary.yml`.

## Refund (cash)

A **cash refund** is money returned to the original payment method. It posts to the `refunds` table as a positive `amount` with a `refund_date` and `reason`. Mapped to `refunds.refund_amount` and `orders.refund_amount` when scoped to orders.

Distinct from store credit and from order `status = 'refunded'`, which is a storefront flag — always check `refunds` rows for dollars returned.

## Store credit

**Store credit** is an account voucher the customer redeems on a future order. It does **not** appear in `refunds.amount`. Agents note issuance in the ticket; finance tracks vouchers separately.

When a customer says "refund" but wants to keep shopping with us, confirm whether they mean cash (`refunds`) or store credit before querying.

## Remake

A **remake** is a no-charge redo of prescription eyewear filed in `remakes`. Reasons include `wrong_prescription`, `breakage`, `fit_issue`, `lens_defect`, and `frame_defect`. The original order remains `completed`; remakes have their own `status` lifecycle.

A remake is not a return and not a cash refund unless ops converts after failed redo.

## Defective

**Defective** means a manufacturing or fulfillment flaw present at delivery or arising from normal wear within warranty — coating peel, hinge snap, edging chip, wrong SKU shipped. Maps to `remakes.reason` of `lens_defect`, `frame_defect`, or `wrong_prescription` when our lab edged incorrect powers.

Defective is **not** "I don't like the color" or "I chose the wrong frame online."

## Buyer's remorse

**Buyer's remorse** is a change-of-mind return with no product flaw — style, fit preference on non-Rx sun, or ordering the wrong color deliberately. Eligible only within the return-policy window. Cash refund via `refunds` with `reason = changed_mind` after warehouse receipt.

Not eligible for prescription lenses edged to custom Rx after the 14-day adaptation window.

## Remake eligibility (summary)

| Criterion | Required |
|-----------|----------|
| Within reason-specific window | Yes |
| No duplicate open remake | Yes |
| Rx verified for wrong-power claims | Yes |
| Photos for breakage/defect | Yes |

## Net revenue note

Period **net revenue** subtracts cash `refunds` by `refund_date` from order totals — store credits and remakes do not reduce `net_revenue` until a separate cash refund posts.