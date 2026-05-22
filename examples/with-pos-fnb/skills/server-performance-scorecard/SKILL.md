---
name: server-performance-scorecard
description: FOH Manager's weekly performance scorecard for servers + bartenders. Average check, covers handled, comp/void rate, tip percentage. Surfaces the strong and weak performers behind the floor.
when_to_use: |
  Load this skill when the user asks about:
    - "Server performance" / "Best server" / "Worst server"
    - "Server scorecard" / "Who's selling the most"
    - "Server comp rate" / "Server void rate" — these are FOH integrity signals
    - "Tip-out audit"
  DON'T load for:
    - Headline outlet revenue → use daily-sales-recap
    - Specific ticket investigation → query tickets directly
audience_role: foh_manager
cadence: weekly
inputs:
  - { name: outlet_id, type: string, required: true }
  - { name: window, type: string, default: "last_7_days" }
outputs:
  - { name: scorecard, type: "row[]", description: "{ server_name, tickets, covers, revenue, avg_check, comp_pct, void_pct, declared_tips, tip_pct }" }
sources:
  - postgres
---

> ## Math discipline — read before doing anything else
>
> **Every arithmetic step in this report happens inside ONE SQL query (CTE-chained), not in your response text.**
>
> Do NOT compute variances, percentages, ratios, deltas, classifications, or aggregates by combining the outputs of multiple `compile_metric` calls. The model is unreliable at multi-step arithmetic; SQL is exact.
>
> Canonical pattern — one `execute_postgres` call returns the *final* shape:
> ```sql
> WITH a AS (-- pull raw inputs),
>      b AS (-- pull more raw inputs),
>      joined AS (
>        SELECT a.key,
>               a.x - b.y                              AS variance,
>               ROUND(100.0 * (a.x - b.y) / NULLIF(b.y, 0), 2) AS variance_pct,
>               CASE WHEN a.x > b.y THEN 'over' ELSE 'under' END AS classification
>        FROM a JOIN b USING (key)
>      )
> SELECT * FROM joined ORDER BY variance_pct DESC;
> ```
>
> **Banned in your reasoning trace:**
> - "Compute X = A - B"
> - "Divide A by B"
> - "The percentage is roughly..."
> - "I'll calculate the variance..."
>
> If a step truly cannot be expressed in SQL, STOP and surface that as a limitation — do not eyeball the math.


# Server performance scorecard

The Friday-afternoon report that decides who runs the patio next week. Used by FOH managers; **do not** circulate to the whole team — it's a coaching tool, not a leaderboard.

## Phase 1 — Per-server ticket + revenue + covers

```ts
compile_metric({
  metric: "revenue",
  segments: ["last_7_days"],
  dimensions: ["tickets.server_id"],
})
compile_metric({
  metric: "ticket_count",
  segments: ["last_7_days"],
  dimensions: ["tickets.server_id"],
})
compile_metric({
  metric: "covers",
  segments: ["last_7_days"],
  dimensions: ["tickets.server_id"],
})
compile_metric({
  metric: "avg_check",
  segments: ["last_7_days"],
  dimensions: ["tickets.server_id"],
})
```

Filter to the outlet via `tickets.outlet_id`.

## Phase 2 — Comp + void rate per server

```ts
compile_metric({ metric: "comp_pct", segments: ["last_7_days"], dimensions: ["tickets.server_id"] })
compile_metric({ metric: "void_pct", segments: ["last_7_days"], dimensions: ["tickets.server_id"] })
```

Comp rate > 5% on a server = either the section is rough or the server is comping to cover service issues. Void rate > 3% = ring-in errors OR theft pattern.

## Phase 3 — Declared tips % of sales

```ts
compile_metric({
  metric: "declared_tips",
  segments: ["last_7_days"],
  dimensions: ["time_entries.employee_id"],
})
```

Then divide by server revenue. Industry tip declaration is typically 12-18% of sales in full-service. Anyone significantly below this is either under-reporting (IRS audit risk for the restaurant) or genuinely serving low-tip channels.

## Phase 4 — Join to employee names

```sql
SELECT e.full_name, ... FROM employees e WHERE e.id IN (<server_ids>);
```

So the report uses names, not opaque emp-ids.

## Phase 5 — Rank + flag

Sort by `revenue DESC`. Then flag any server where:
- `comp_pct > 5` → coach
- `void_pct > 3` → audit
- `tip_pct < 10` → tip-declaration conversation
- `avg_check < 70% of outlet median` → upselling coaching

## Output format

- **Top performer:** "<name> — $<rev> on <covers> covers, avg check $<X>, tip pct <Y>%."
- **Coaching list:** numbered list of servers needing a conversation, with the flag reason.
- **Full scorecard table:** name | tickets | covers | revenue | avg_check | comp% | void% | declared_tips | tip%
- **Assumptions:** outlet filter applied; only tip-eligible employees in scope.

## Self-correction

- **Server with 0 tickets?** Was scheduled but didn't ring anything in (might be a host or busser misclassified). Cross-check `employees.role`.
- **Comp rate is 0% across all servers?** Comps are recorded against the manager who authorized them, not the server. Re-pull joining via `tickets.server_id` (the server who owned the table) vs `tickets.comp_reason` (which contains the authorizer).
- **Tip% is wildly above sales?** Tips are declared separately and one server may have served high-tip private events. Sanity-check the period before flagging.
