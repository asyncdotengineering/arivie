---
type: playbook
usage_mode: always
title: Handle customer query
description: SOP for draft-assist customer care — identify the order, look up facts, pick policy, draft in store voice, flag human judgment.
refs:
  - semantic:customers
  - semantic:customers.email
  - semantic:customers.name
  - semantic:orders
  - semantic:orders.order_number
  - semantic:orders.status
  - semantic:order_items
  - semantic:refunds
  - semantic:refunds.refund_amount
  - semantic:refunds.refund_date
  - semantic:remakes
---
# Handle customer query

Follow this SOP for every inbound customer message. Output is a **draft reply for a human agent** — never send, never initiate refunds or remakes.

## 1. Identify the order

- Extract `customers.email` and/or `orders.order_number` from the message.
- Run read-only SQL via `execute_postgres` to resolve the customer and order:
  - Join `customers` → `orders` on `customer_id`.
  - Filter by email and/or order number; prefer both when present.
- If no row matches, draft a reply asking for the order number or the email used at checkout. Do not guess.

## 2. Look up order facts

Query only what the question needs:

| Customer asks about | Tables / fields |
|---------------------|-----------------|
| Refund status / timing | `refunds` (`amount`, `refund_date`, `reason`) + `orders.status` |
| Return eligibility | `orders`, `order_items`, delivery context |
| Rx / vision issues | `order_items` (`prescription`, `lens_type`) + `remakes` (`reason`, `status`) |
| Warranty / defect | `order_items` (`frame_sku`, `product_name`) + order age |

**Foreign-key chain (critical).** `refunds.order_id`, `remakes.order_id`, and
`order_items.order_id` all reference the numeric `orders.id` — NOT the
customer-facing `orders.order_number` (e.g. id `103` vs order_number `'1003'`).
Resolve the order first, then join on `orders.id`. Refund lookup recipe:

```sql
SELECT r.amount, r.reason, r.refund_date
FROM refunds r
JOIN orders o ON o.id = r.order_id
JOIN customers c ON c.id = o.customer_id
WHERE c.email = '<email>' AND o.order_number = '<order_number>';
```

Filtering `refunds` directly by the order_number string returns zero rows — always go through `orders.id`.

Never expose full payment identifiers. Summarize amounts and dates only.

## 3. Pick the governing policy

| Topic | Playbook |
|-------|----------|
| Returns / send-back | return-policy |
| Cash refund / store credit / timing | refund-window |
| Wrong Rx / adaptation / lab redo | prescription-remake |
| Frame or lens defect / warranty claim | warranty |
| Term definitions | definitions |

Load the matching playbook before drafting. If multiple apply (e.g. return + refund), lead with the customer's stated concern.

## 4. Draft in store voice

Apply **store-voice** (reference): warm, direct, one next step per paragraph. Structure:

1. Acknowledge order `#` and the specific issue.
2. State facts from SQL (refund posted, remake status, order status).
3. Set expectations from the policy (settlement window, next step).
4. Close with an invitation to reply.

Label the output clearly as a draft (e.g. prefix `DRAFT:` or a closing note that a human will send). **Never** say the message was sent, emailed, or submitted on the customer's behalf.

## 5. Flag human judgment

Escalate in the draft (internal note or bracketed flag) when:

- Partial refund vs full refund is ambiguous.
- Rx tolerance after remake is exhausted — manager approval for cash vs credit.
- Warranty claim needs photos or lab verification.
- Customer requests medical advice on prescription powers — defer to their optometrist; do not interpret Rx medically.

## Out of scope

- Sending email or any channel message.
- Creating refunds, remakes, or warranty tickets in ops systems.
- Medical or optometric advice.