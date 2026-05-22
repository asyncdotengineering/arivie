---
name: revenue-attribution
description: Attribute revenue to acquisition channels / signup sources / marketing campaigns and surface the top contributors and the largest period-over-period swings.
when_to_use: |
  Load this skill when the user asks about:
    - "What drove revenue this quarter" / "where is revenue coming from"
    - "Attribution" / "by channel" / "by campaign" / "by signup source"
    - "Which marketing channel brought our best customers"
    - "Why did revenue spike in March"
  DON'T load for:
    - Pure revenue totals (no attribution dimension) → `compile_metric({metric: "revenue"})`
    - Predictive marketing-mix modeling → out of scope
inputs:
  - { name: attribution_dim, type: string, default: "signup_source", description: "Customer attribute that maps users to acquisition channels (signup_source, first_referrer, campaign_id, etc.)" }
  - { name: window, type: string, default: "current_quarter", description: "Declared segment name (e.g. 'current_quarter') OR a custom window like '2026-01-01..2026-03-31'" }
  - { name: compare_to, type: string, default: "previous_quarter", description: "Period-over-period comparison window" }
outputs:
  - { name: contribution_table, type: "row[]", description: "{ channel, revenue_current, revenue_compare_to, abs_delta, pct_change, share_of_current }" }
  - { name: top_contributors, type: "string[]", description: "Top 3 channels by current-period revenue" }
  - { name: largest_swings, type: "string[]", description: "Top 3 channels by abs_delta" }
sources:
  - postgres
---

# Revenue-attribution playbook

## Phase 1 — Verify the attribution dimension exists

The skill is useless if customers don't carry an attribution attribute. Before any SQL:

1. Run `cat semantic/entities/customers.yml | grep -A1 -E "signup_source|first_referrer|campaign"` to see what's declared.
2. If `attribution_dim` isn't a column on `customers`, stop and ask the user to specify which column to use. Don't guess.

## Phase 2 — Pull current-period revenue by attribution dim

Prefer `compile_metric` if `revenue` is a declared measure AND `customers.<attribution_dim>` is a declared dimension:

```ts
compile_metric({
  metric: "revenue",
  dimensions: [`customers.${attribution_dim}`],
  segments: [window],          // e.g. ["current_quarter"]
})
```

This is the cleanest path — leverages the declared measure semantics + walks the orders → customers join automatically.

If `window` is a custom date range (not a declared segment), fall back to `execute`:

```sql
SELECT
  c.{{attribution_dim}} AS channel,
  SUM(o.total_amount) FILTER (WHERE o.status = 'completed') AS revenue
FROM orders o
JOIN customers c ON o.customer_id = c.id
WHERE o.created_at >= {{window_start}}
  AND o.created_at < {{window_end}}
GROUP BY c.{{attribution_dim}}
ORDER BY revenue DESC;
```

## Phase 3 — Pull compare-to period revenue (same shape, different window)

Same query, different `window_start`/`window_end`. Use the same `compile_metric` shape if possible.

## Phase 4 — Join the two periods into a comparison table

Do this in SQL with a CTE OR in markdown after the two queries — both are valid. The CTE form:

```sql
WITH current_period AS (
  SELECT c.{{attribution_dim}} AS channel,
         SUM(o.total_amount) FILTER (WHERE o.status = 'completed') AS revenue
  FROM orders o JOIN customers c ON o.customer_id = c.id
  WHERE o.created_at >= {{current_start}} AND o.created_at < {{current_end}}
  GROUP BY 1
),
compare_period AS (
  SELECT c.{{attribution_dim}} AS channel,
         SUM(o.total_amount) FILTER (WHERE o.status = 'completed') AS revenue
  FROM orders o JOIN customers c ON o.customer_id = c.id
  WHERE o.created_at >= {{compare_start}} AND o.created_at < {{compare_end}}
  GROUP BY 1
)
SELECT
  COALESCE(cp.channel, pp.channel)                                                       AS channel,
  COALESCE(cp.revenue, 0)                                                                AS revenue_current,
  COALESCE(pp.revenue, 0)                                                                AS revenue_compare_to,
  COALESCE(cp.revenue, 0) - COALESCE(pp.revenue, 0)                                      AS abs_delta,
  ROUND(100.0 * (COALESCE(cp.revenue, 0) - COALESCE(pp.revenue, 0))
        / NULLIF(COALESCE(pp.revenue, 0), 0), 1)                                         AS pct_change,
  ROUND(100.0 * COALESCE(cp.revenue, 0)
        / NULLIF((SELECT SUM(revenue) FROM current_period), 0), 1)                       AS share_of_current
FROM current_period cp
FULL OUTER JOIN compare_period pp ON cp.channel = pp.channel
ORDER BY revenue_current DESC NULLS LAST;
```

**FULL OUTER JOIN** is critical — a channel that existed last quarter but not this quarter (revenue dropped to 0) should still appear. INNER would hide the worst case.

## Phase 5 — Surface top contributors + largest swings

Two slices of the same table:
- **Top contributors** = top 3 by `revenue_current`. ("Channels paid_search, organic, and referral contributed 78% of this quarter's revenue.")
- **Largest swings** = top 3 by `|abs_delta|`. Include direction: ("Paid_search grew +$45k QoQ; webinar dropped -$22k.")

If a channel has 0 revenue in compare_to, `pct_change` is NULL (division by zero) — surface as "new this period" not as "infinite growth."

## Phase 6 — Self-correction

- **All channels show identical revenue both periods**? Either no time-window filter applied, or `compare_to` and `window` resolved to the same range. Verify the windows.
- **`share_of_current` doesn't sum to ~100%**? You may have NULL `attribution_dim` rows — disclose what fraction is unattributed.
- **`revenue_current` is 0 across the board**? `status = 'completed'` filter may be excluding everything. Try without the filter to see if any orders exist in the window.

## JOIN discipline reminder

- `orders` ⨝ `customers` is INNER — every order has a customer. State this.
- `current_period` ⨝ `compare_period` is FULL OUTER — a channel might exist in one period but not the other. State this.

## Output format

- **Result:** one-paragraph headline with the top contributors AND the largest swings, named.
- **Assumptions:** which window/compare_to dates resolved to, which attribution dim was used, what fraction of revenue is unattributed.
- **SQL:** the CTE block from Phase 4.
- **Contribution table** as markdown after the three sections, top 10 channels.
