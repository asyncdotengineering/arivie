---
type: playbook
title: Return policy
description: When and how Lens & Luxe customers can return eyewear; condition requirements and non-returnable Rx orders.
---
# Return policy

Use this playbook when a customer asks to send back frames, lenses, or a complete pair for a refund or exchange.

## Eligibility window

- **Standard frames (no Rx):** 30 days from delivery date.
- **Prescription eyewear:** 14 days from delivery for fit or adaptation issues only — not buyer's remorse (see prescription-remake).
- **Accessories** (cases, chains): 30 days, unused and in original packaging.

Clock starts on carrier **delivered** scan, not order `created_at`.

## Condition requirements

Returns must arrive with:

1. Original frame (no structural damage beyond normal try-on wear).
2. All included accessories and packaging.
3. Rx lenses unaltered — no third-party edging or coating.

Inspect `order_items` for `lens_type` and Rx fields before promising a return label.

## Non-returnable

- **Custom prescription lenses** edged to the submitted Rx — cannot be resold; route to remake or warranty instead.
- Orders marked **completed** more than 30 days ago (14 days for Rx adaptation claims).
- Items showing intentional damage, missing parts, or non-brand lens swaps.

## Procedure

1. Look up the order by `order_number` or customer `email`.
2. Confirm delivery date and `status` (not `cancelled` or `failed`).
3. If eligible, issue a prepaid return label via the care portal; set expectation of 5–7 business days after warehouse receipt.
4. On receipt, post a cash refund (`refunds`) or store credit per refund-window — never both for the same line.

## Do not

- Promise returns on progressive or high-index Rx without checking the 14-day adaptation window.
- Refund shipping on buyer's-remorse returns unless the error was ours (wrong SKU shipped).