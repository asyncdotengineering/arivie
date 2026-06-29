---
type: playbook
title: Frame and lens warranty
description: Lens & Luxe warranty coverage for frames and lenses, claim steps, and when to route to remakes instead.
refs:
  - semantic:order_items
  - semantic:order_items.frame_sku
  - semantic:order_items.lens_type
  - semantic:remakes
---
# Frame and lens warranty

Use for manufacturing defects, coating failure, hinge breakage, or lens delamination — not for prescription power disputes (see prescription-remake).

## Coverage

| Component | Term | Covers |
|-----------|------|--------|
| Frames (`frame_sku`) | 12 months from delivery | Hinge failure, finish defect, structural flaw at normal wear |
| Lenses | 12 months | Coating peel, delamination, impact-free chips from edging defect |
| Accessories | 90 days | Case zipper, cleaning cloth defects |

Wear-and-tear scratches, lost screws from customer adjustment, and damage from drops are **not** warranty — offer paid repair or replacement discount instead.

## Claim steps

1. Look up the order and `order_items` — confirm `frame_sku` and `lens_type`.
2. Ask for photos of the defect and a brief description.
3. If within term and defect qualifies, open a `remakes` row with `frame_defect` or `lens_defect`.
4. Ship replacement at no charge; customer keeps or returns the defective unit per ops instruction (label provided when required).
5. Log warranty grants — do not also post a `refunds` row unless ops approves a partial goodwill credit.

## Warranty vs remake vs return

- **Warranty** — manufacturing defect at receipt or early failure; no Rx change.
- **Remake** — Rx wrong, fit adaptation, or breakage after wear (prescription-remake).
- **Return** — buyer's remorse within return window (return-policy).

## Do not

- Extend warranty beyond 12 months without manager approval.
- Replace lenses under warranty without checking whether the issue is power-related (route to Rx verification first).