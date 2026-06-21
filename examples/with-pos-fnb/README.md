# Arivie — F&B POS Example (Lumière Chain)

The flagship Arivie example: production-grade F&B analytics **and** full framework coverage — semantic layer, SOP skills, schedules, channels, subscriptions, conversation continuity, API-first server, and `arivie chat`.

Multi-outlet from day one — three Lumière outlets (Bistro / Riverside / Westside) seeded with 14 days of realistic operational data. Skills are SOP playbooks per role: every analytics question maps to a documented standard operating procedure.

---

## What's in the box

| Layer | Detail |
|---|---|
| Framework | Channels (ops-alert, GitHub push), subscriptions, cron schedules, API server, spike script |
| Schema | 18 tables — `outlets`, `menu_categories`, `menu_items`, `modifiers`, `ingredients`, `recipe_lines`, `suppliers`, `purchase_orders`, `purchase_order_lines`, `stock_movements`, `tickets`, `ticket_items`, `ticket_item_modifiers`, `tenders`, `employees`, `shifts`, `time_entries`, `gl_accounts`, `gl_entries` |
| Seed scale | 3 outlets × 14 days × ~50 tickets/day → ~2,600 tickets, ~8,900 line items, ~2,700 tender lines, ~16,700 stock movements, ~800 GL entries |
| Semantic layer | 15 entity YAMLs with F&B-canonical measures (`revenue`, `comp_pct`, `void_pct`, `avg_check`, `covers`, `gl_cogs`, `gl_labor`, `actual_consumption_cost`, `waste_cost`, `processor_fees`, …) and segments (`current_business_day`, `last_7_days`, `last_14_days`, `this_week`) — 4am business-day cutoff respected |
| Skills | 10 SOP playbooks. See the role map below. |

---

## Role hierarchy → report cadence → SOP skill

| Role | Cadence | Report | Skill | Headline measures pulled |
|---|---|---|---|---|
| **Owner / Operator** | Weekly | Prime-cost recap (food + labor as % of revenue) | [`prime-cost-recap`](./skills/prime-cost-recap/SKILL.md) | `revenue`, `gl_cogs`, `gl_labor` |
| **General Manager (GM)** | Daily | Yesterday's recap — revenue, covers, avg check, comps/voids, top items | [`daily-sales-recap`](./skills/daily-sales-recap/SKILL.md) | `revenue`, `ticket_count`, `covers`, `avg_check`, `comp_pct`, `void_pct` |
| **General Manager (GM)** | Weekly (Monday) | Flash report — WoW revenue, prime cost, KPIs | [`weekly-flash-report`](./skills/weekly-flash-report/SKILL.md) | `revenue`, `comp_pct`, `void_pct`, `gl_cogs`, `gl_labor` |
| **Executive Chef** | Weekly | Theoretical vs actual food cost variance | [`food-cost-variance`](./skills/food-cost-variance/SKILL.md) | `theoretical_food_cost`, `actual_consumption_cost`, `waste_cost` |
| **Executive Chef** | Quarterly | Menu engineering matrix (star/plowhorse/puzzle/dog) | [`menu-engineering-matrix`](./skills/menu-engineering-matrix/SKILL.md) | `units_sold`, `item_revenue`, `theoretical_margin` |
| **FOH Manager** | Weekly | Server / bartender scorecard | [`server-performance-scorecard`](./skills/server-performance-scorecard/SKILL.md) | `revenue`, `avg_check`, `covers`, `comp_pct`, `void_pct`, `declared_tips` |
| **FOH Manager** | Daily | Comp/void trend — loss-prevention scan | [`void-comp-trend`](./skills/void-comp-trend/SKILL.md) | `comp_pct`, `void_pct`, `comp_amount`, `void_amount` |
| **Bar Manager** | Weekly | Pour cost investigation | [`pour-cost-investigation`](./skills/pour-cost-investigation/SKILL.md) | `actual_consumption_cost` (bar), `theoretical_food_cost` (alcohol filter) |
| **Bookkeeper** | Daily | EOD close packet | [`end-of-day-close`](./skills/end-of-day-close/SKILL.md) | `tendered_amount`, `processor_fees`, `gl_revenue`, GL trial balance |
| **Bookkeeper** | Daily | Z-out three-way reconciliation | [`daily-z-out-reconciliation`](./skills/daily-z-out-reconciliation/SKILL.md) | `tendered_amount`, ticket totals, GL totals |
| **Line cook / Server / Busser** | n/a | Not a reporting audience — they consume schedules, not analytics. |

---

## Setup

1. **Create the database + apply schema + seed:**
   ```bash
   # From repo root
   psql -d postgres -c "CREATE DATABASE arivie_pos OWNER CURRENT_USER;"
   psql -d arivie_pos -f arivie/examples/with-pos-fnb/db/schema.sql
   DATABASE_URL=postgresql://localhost:5432/arivie_pos \
     pnpm -C arivie exec tsx examples/with-pos-fnb/db/seed.ts
   ```

2. **Configure env:** put `OPENAI_API_KEY` and `DATABASE_URL` in
   `examples/with-pos-fnb/.env.local` (or a repo-root `.env`). The CLI
   auto-loads `.env` / `.env.local` from the config's directory and any parent,
   so you don't export them by hand.
   ```bash
   # examples/with-pos-fnb/.env.local
   OPENAI_API_KEY=sk-...
   DATABASE_URL=postgresql://localhost:5432/arivie_pos
   ```

3. **Chat with it** (the canonical terminal runner):
   ```bash
   pnpm --filter @arivie/cli build   # first time, for the `arivie` bin
   pnpm exec arivie chat --config examples/with-pos-fnb/arivie.config.ts
   ```
   - A real terminal opens the Ink TUI: start a new conversation or resume a saved
     thread (history persists in `.arivie/memory.db`); ask e.g. *"What was prime
     cost across the chain last week?"*.
   - `--role arivie_reader` runs the agent's SQL under the least-privilege role
     (recommended). `--role` is **optional** for local testing — without it the
     SELECT-only SQL guard still blocks writes.
   - Non-TTY/piped input uses the line REPL:
     `printf 'prime cost last week?\n/exit\n' | pnpm exec arivie chat --config examples/with-pos-fnb/arivie.config.ts`.

4. **API server** (channels + subscriptions + `/chat`):
   ```bash
   pnpm --filter with-pos-fnb api
   ```
   Then `POST http://localhost:3000/chat` with `{ "message": "…", "conversationId": "…" }`.
   Channel webhooks mount at `/channels/ops-alert/closeout` and `/channels/github.push/push`.

5. **End-to-end spike** (continuity + channels smoke test):
   ```bash
   pnpm --filter with-pos-fnb spike
   ```
   Expect: continuity store `STORED`, recall `LUMIERE_PRIME`, ops alert status `200`, github push status `200`.

6. **Schedules** — three cron jobs in `arivie.config.ts` map to real skills:
   - `daily-sales-recap` — daily at 2am CT (after 4am business-day cutoff)
   - `weekly-flash-report` — Monday 8am CT
   - `prime-cost-recap` — Monday 7am CT

---

## What makes this realistic

- **4am business-day cutoff.** Late-night tickets opened at 1:30am stamp `business_day = D` (yesterday), not `D+1`. The semantic layer's `business_day` field already applies this — queries use it instead of `date_trunc(opened_at)`.
- **Multi-tender per ticket.** Split checks generate multiple `tenders` rows. The Z-out reconciliation skill catches anywhere they don't add up.
- **Recipe-driven stock consumption.** Every non-voided ticket_item emits `stock_movements` rows from its `recipe_lines`. Theoretical food cost variance against actual is computable end-to-end.
- **Daily double-entry GL postings.** End-of-day close emits balanced DR/CR per outlet: revenue (food/alcohol/N-A) credited; cash + CC + 3PD receivable debited; COGS debited against inventory; labor split FOH/BOH/Mgmt.
- **Realistic comp/void rates.** ~2% comp, ~1% void — within the industry healthy band. The `void-comp-trend` skill surfaces servers exceeding the baseline.
- **3PD marketplace fees baked in.** DoorDash/UberEats/Grubhub orders carry 30% processor fees as separate tender lines — the close packet shows net deposit accordingly.
- **Daypart patterns per concept.** Bistro is dinner-heavy (full service), Riverside is lunch + brunch, Westside is bar/late-night. Average check varies accordingly.

---

## Industry KPI thresholds (used across the skills)

| KPI | Healthy band | Skill that surfaces it |
|---|---|---|
| Prime cost % (Full-service) | ≤ 60% of revenue | `prime-cost-recap` |
| Food cost % | 28-32% of food revenue | `food-cost-variance` |
| Pour cost % (blended bar) | 20-24% of alcohol revenue | `pour-cost-investigation` |
| Labor % | 28-35% of revenue | `prime-cost-recap`, `weekly-flash-report` |
| Comp % | 1-2% (investigate >3%) | `daily-sales-recap`, `void-comp-trend` |
| Void % | <1% (investigate >2%) | `daily-sales-recap`, `void-comp-trend` |
| Waste % | <2% of food revenue | `food-cost-variance` |
| Average check (FS) | $35-90 | `daily-sales-recap`, `weekly-flash-report` |

---

## Notes

- This example is read-only. Skills compose queries; nothing here writes back to the DB.
- The `arivie_reader` role is created by `schema.sql` and granted SELECT on every table. The agent runs as this role.
- Skills auto-discover via `workspace.skillsMode: "auto"` — the agent reads each `SKILL.md`'s frontmatter `when_to_use` block to decide which skill matches the user's prompt.
- Adding a fourth outlet is a seed-only change. Adding a fourth role is a `skills/<role-skill>/SKILL.md` change plus a row in the table above.
