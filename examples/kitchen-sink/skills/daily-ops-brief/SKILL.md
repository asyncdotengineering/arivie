---
name: daily-ops-brief
description: Daily GM closeout brief for revenue, covers, avg check, comps, voids, and operational flags by outlet.
license: Apache-2.0
---

## When to use

Use this skill when the user asks for a daily recap, GM morning brief, closeout summary, yesterday's sales, or comp/void exceptions.

## Rules

- Use `compile_metric` for canonical measures when possible.
- If calculating percentages, deltas, or classifications, do the arithmetic inside SQL.
- Always mention the target thresholds: comp_pct > 3% and void_pct > 2% require investigation.
- Prefer `tickets.business_day` over raw timestamps.

## Suggested flow

1. Pull `revenue`, `ticket_count`, `covers`, `avg_check`, `comp_pct`, and `void_pct` by `tickets.outlet_id` for `current_business_day`.
2. Join outlet names for readability.
3. Return a concise operator brief with one action item per flagged outlet.
