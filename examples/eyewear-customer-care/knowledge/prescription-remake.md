---
type: playbook
usage_mode: always
title: Prescription remake policy
description: Rx redo eligibility — wrong prescription, adaptation, breakage — and how to verify the order Rx before filing a remake.
refs:
  - semantic:remakes
  - semantic:remakes.open_remake_count
  - semantic:order_items.lens_type
  - semantic:order_items.prescription
---
# Prescription remake policy

Use when vision is blurry, powers feel wrong, frames broke in normal use, or the lab error is suspected. A **remake** ships a replacement pair at no charge; it is not a cash refund.

## Remake reasons (semantic `remakes.reason`)

| Reason | When it applies | Window |
|--------|-----------------|--------|
| `wrong_prescription` | Submitted Rx ≠ what we edged (lab or entry error) | 90 days from delivery |
| `fit_issue` | Progressive corridor or PD off; adaptation failed after 14-day wear | 60 days |
| `breakage` | Frame or lens failure in normal wear (not abuse) | 12 months |
| `lens_defect` / `frame_defect` | Manufacturing defect at receipt | 12 months |

One open remake per `order_id` at a time — check `open_remake_count` before promising another redo.

## Wrong Rx vs adaptation vs breakage

- **Wrong prescription** — compare customer-provided Rx photo to `order_items` (`rx_sphere_od`, `rx_cylinder_od`, `rx_axis_od`, OS fields, and `prescription` JSON). Any diopter or axis mismatch → `wrong_prescription`.
- **Adaptation** — powers match the order but the customer cannot adapt (common with first progressives). Route to `fit_issue`; offer optometrist verification before remake.
- **Breakage** — physical damage; require photos. Hinges, temples, or lens chip without impact abuse → `breakage` or defect reason.

## Verify the order Rx

1. Load `order_items` for the `order_id`.
2. Read `lens_type` — progressives have stricter adaptation rules.
3. Compare each Rx field to the customer's uploaded prescription or OD/OS values they quote.
4. If mismatch, cite the edged values in the draft (do not interpret medical necessity).

## Procedure

1. Confirm delivery date within the reason-specific window.
2. Check for existing `remakes` on the order (`status` not `cancelled`).
3. File remake with the correct `reason`; set expectation of 10–14 business days in production.
4. Original order stays `completed` — remakes are a separate fulfillment track.

## Do not

- Offer medical advice or suggest they change Rx with their doctor — refer them to their optometrist for power questions.
- Promise a remake for buyer's remorse (frame color dislike) — use return-policy instead.