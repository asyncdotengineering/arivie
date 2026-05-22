-- SPDX-License-Identifier: Apache-2.0
-- examples/with-pos-fnb — Production-grade F&B POS schema.
-- 18 tables covering: outlets, menu, modifiers, recipes, inventory, suppliers,
-- tickets + items + modifier-instances, tenders, employees + shifts + time entries,
-- accounting (GL). Multi-outlet from day one (outlet_id FK everywhere).
--
-- Apply with: psql -d arivie_pos -f schema.sql

BEGIN;

DROP TABLE IF EXISTS gl_entries CASCADE;
DROP TABLE IF EXISTS gl_accounts CASCADE;
DROP TABLE IF EXISTS time_entries CASCADE;
DROP TABLE IF EXISTS shifts CASCADE;
DROP TABLE IF EXISTS employees CASCADE;
DROP TABLE IF EXISTS tenders CASCADE;
DROP TABLE IF EXISTS ticket_item_modifiers CASCADE;
DROP TABLE IF EXISTS ticket_items CASCADE;
DROP TABLE IF EXISTS tickets CASCADE;
DROP TABLE IF EXISTS stock_movements CASCADE;
DROP TABLE IF EXISTS purchase_order_lines CASCADE;
DROP TABLE IF EXISTS purchase_orders CASCADE;
DROP TABLE IF EXISTS suppliers CASCADE;
DROP TABLE IF EXISTS recipe_lines CASCADE;
DROP TABLE IF EXISTS ingredients CASCADE;
DROP TABLE IF EXISTS modifiers CASCADE;
DROP TABLE IF EXISTS menu_items CASCADE;
DROP TABLE IF EXISTS menu_categories CASCADE;
DROP TABLE IF EXISTS outlets CASCADE;

-- ════════════════════════════════════════════════════════════════════════
-- OUTLETS — locations in the chain
-- ════════════════════════════════════════════════════════════════════════
CREATE TABLE outlets (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  brand            TEXT NOT NULL,
  concept          TEXT NOT NULL CHECK (concept IN ('full_service', 'fast_casual', 'bar', 'cafe')),
  city             TEXT NOT NULL,
  state            TEXT NOT NULL,
  country          TEXT NOT NULL DEFAULT 'US',
  timezone         TEXT NOT NULL DEFAULT 'America/New_York',
  business_day_cutoff_hour INT NOT NULL DEFAULT 4
    CHECK (business_day_cutoff_hour BETWEEN 0 AND 12),
  opened_on        DATE NOT NULL,
  seats            INT NOT NULL,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE
);

COMMENT ON COLUMN outlets.business_day_cutoff_hour IS
  'Hour of day (0-12 local time) that closes the business day. Tickets stamped before this hour on day D+1 still count as business_day D. F&B standard: 4am.';

-- ════════════════════════════════════════════════════════════════════════
-- MENU
-- ════════════════════════════════════════════════════════════════════════
CREATE TABLE menu_categories (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  course      TEXT NOT NULL CHECK (course IN ('starter', 'main', 'dessert', 'side', 'beverage', 'cocktail', 'wine', 'beer', 'spirit', 'non_alcoholic')),
  sort_order  INT NOT NULL DEFAULT 0
);

CREATE TABLE menu_items (
  id              SERIAL PRIMARY KEY,
  sku             TEXT NOT NULL UNIQUE,
  category_id     INT NOT NULL REFERENCES menu_categories(id),
  name            TEXT NOT NULL,
  description     TEXT,
  list_price      NUMERIC(10, 2) NOT NULL,
  theoretical_food_cost NUMERIC(10, 4) NOT NULL,
  is_alcoholic    BOOLEAN NOT NULL DEFAULT FALSE,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  -- Menu-engineering classification, refreshed quarterly.
  menu_class      TEXT CHECK (menu_class IN ('star', 'plowhorse', 'puzzle', 'dog'))
);

COMMENT ON COLUMN menu_items.theoretical_food_cost IS
  'Theoretical cost per portion in USD. Used for prime-cost calculations vs actual food cost.';

CREATE TABLE modifiers (
  id              SERIAL PRIMARY KEY,
  menu_item_id    INT REFERENCES menu_items(id),
  name            TEXT NOT NULL,
  modifier_group  TEXT NOT NULL,
  price_delta     NUMERIC(10, 2) NOT NULL DEFAULT 0,
  is_default      BOOLEAN NOT NULL DEFAULT FALSE
);

COMMENT ON COLUMN modifiers.menu_item_id IS
  'NULL = global modifier (e.g. "extra cheese", "no onion"). Non-NULL = item-specific.';

-- ════════════════════════════════════════════════════════════════════════
-- INVENTORY + RECIPES
-- ════════════════════════════════════════════════════════════════════════
CREATE TABLE ingredients (
  id              SERIAL PRIMARY KEY,
  sku             TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  category        TEXT NOT NULL CHECK (category IN ('protein', 'produce', 'dairy', 'dry', 'frozen', 'beverage_na', 'beer', 'wine', 'spirit', 'liqueur', 'mixer', 'paper', 'cleaning')),
  unit            TEXT NOT NULL,  -- 'g', 'ml', 'each', 'lb'
  shelf_life_days INT NOT NULL DEFAULT 30
);

CREATE TABLE recipe_lines (
  id              SERIAL PRIMARY KEY,
  menu_item_id    INT NOT NULL REFERENCES menu_items(id),
  ingredient_id   INT NOT NULL REFERENCES ingredients(id),
  qty             NUMERIC(10, 4) NOT NULL,
  unit            TEXT NOT NULL,
  UNIQUE (menu_item_id, ingredient_id)
);

COMMENT ON TABLE recipe_lines IS
  'Bill of materials: menu_item -> ingredients with portion quantities. Drives theoretical food cost.';

CREATE TABLE suppliers (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  category      TEXT NOT NULL,
  contact_email TEXT,
  payment_terms TEXT NOT NULL DEFAULT 'net_30'
);

CREATE TABLE purchase_orders (
  id              TEXT PRIMARY KEY,
  outlet_id       TEXT NOT NULL REFERENCES outlets(id),
  supplier_id     INT NOT NULL REFERENCES suppliers(id),
  ordered_at      TIMESTAMPTZ NOT NULL,
  delivered_at    TIMESTAMPTZ,
  status          TEXT NOT NULL CHECK (status IN ('draft', 'sent', 'partial', 'received', 'cancelled')),
  total_cost      NUMERIC(12, 2) NOT NULL DEFAULT 0,
  invoice_number  TEXT
);

CREATE TABLE purchase_order_lines (
  id                  SERIAL PRIMARY KEY,
  purchase_order_id   TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  ingredient_id       INT NOT NULL REFERENCES ingredients(id),
  qty                 NUMERIC(12, 4) NOT NULL,
  unit_cost           NUMERIC(10, 4) NOT NULL,
  line_total          NUMERIC(12, 2) NOT NULL
);

CREATE TABLE stock_movements (
  id              BIGSERIAL PRIMARY KEY,
  outlet_id       TEXT NOT NULL REFERENCES outlets(id),
  ingredient_id   INT NOT NULL REFERENCES ingredients(id),
  movement_type   TEXT NOT NULL CHECK (movement_type IN ('receive', 'consume', 'waste', 'transfer_in', 'transfer_out', 'count_adjust')),
  qty             NUMERIC(12, 4) NOT NULL,  -- always positive; sign by movement_type
  unit_cost       NUMERIC(10, 4),  -- snapshot at time of movement
  occurred_at     TIMESTAMPTZ NOT NULL,
  reference       TEXT,  -- e.g. PO id, ticket id, count session id
  notes           TEXT
);

COMMENT ON COLUMN stock_movements.qty IS
  'Always positive. Sign convention applied at query time based on movement_type: receive/transfer_in/count_adjust+ add, consume/waste/transfer_out subtract.';

CREATE INDEX idx_stock_movements_outlet_ingredient_date
  ON stock_movements(outlet_id, ingredient_id, occurred_at);

-- ════════════════════════════════════════════════════════════════════════
-- TICKETS — orders/checks/guest checks (industry uses all three terms)
-- ════════════════════════════════════════════════════════════════════════
CREATE TABLE tickets (
  id                  TEXT PRIMARY KEY,
  outlet_id           TEXT NOT NULL REFERENCES outlets(id),
  ticket_number       INT NOT NULL,           -- per-outlet daily counter
  business_day        DATE NOT NULL,          -- the operating day (4am cutoff)
  opened_at           TIMESTAMPTZ NOT NULL,
  closed_at           TIMESTAMPTZ,
  service_type        TEXT NOT NULL CHECK (service_type IN ('dine_in', 'takeout', 'delivery', 'bar', 'online')),
  channel             TEXT CHECK (channel IN ('in_house', 'doordash', 'ubereats', 'grubhub', 'own_app', 'phone', 'walk_in')),
  table_number        INT,                    -- NULL for non-dine-in
  guest_count         INT NOT NULL DEFAULT 1,
  server_id           TEXT,  -- FK added at end of file (employees declared after this)
  subtotal            NUMERIC(10, 2) NOT NULL DEFAULT 0,
  discount_amount     NUMERIC(10, 2) NOT NULL DEFAULT 0,
  comp_amount         NUMERIC(10, 2) NOT NULL DEFAULT 0,
  void_amount         NUMERIC(10, 2) NOT NULL DEFAULT 0,
  tax_amount          NUMERIC(10, 2) NOT NULL DEFAULT 0,
  tip_amount          NUMERIC(10, 2) NOT NULL DEFAULT 0,
  total_amount        NUMERIC(10, 2) NOT NULL DEFAULT 0,
  status              TEXT NOT NULL CHECK (status IN ('open', 'closed', 'voided', 'comped', 'transferred')),
  void_reason         TEXT,
  comp_reason         TEXT,
  notes               TEXT,
  UNIQUE (outlet_id, business_day, ticket_number)
);

CREATE INDEX idx_tickets_outlet_day ON tickets(outlet_id, business_day);
CREATE INDEX idx_tickets_server_day ON tickets(server_id, business_day);

CREATE TABLE ticket_items (
  id                  BIGSERIAL PRIMARY KEY,
  ticket_id           TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  menu_item_id        INT NOT NULL REFERENCES menu_items(id),
  qty                 INT NOT NULL DEFAULT 1,
  unit_price          NUMERIC(10, 2) NOT NULL,
  line_subtotal       NUMERIC(10, 2) NOT NULL,
  discount_amount     NUMERIC(10, 2) NOT NULL DEFAULT 0,
  comp_amount         NUMERIC(10, 2) NOT NULL DEFAULT 0,
  void_amount         NUMERIC(10, 2) NOT NULL DEFAULT 0,
  course              TEXT,
  sent_to_kitchen_at  TIMESTAMPTZ,
  fired_at            TIMESTAMPTZ,
  is_voided           BOOLEAN NOT NULL DEFAULT FALSE,
  is_comped           BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX idx_ticket_items_ticket ON ticket_items(ticket_id);
CREATE INDEX idx_ticket_items_menu_item ON ticket_items(menu_item_id);

CREATE TABLE ticket_item_modifiers (
  id              BIGSERIAL PRIMARY KEY,
  ticket_item_id  BIGINT NOT NULL REFERENCES ticket_items(id) ON DELETE CASCADE,
  modifier_id     INT NOT NULL REFERENCES modifiers(id),
  price_delta     NUMERIC(10, 2) NOT NULL DEFAULT 0
);

-- ════════════════════════════════════════════════════════════════════════
-- TENDERS — every payment line on a ticket
-- ════════════════════════════════════════════════════════════════════════
CREATE TABLE tenders (
  id              TEXT PRIMARY KEY,
  ticket_id       TEXT NOT NULL REFERENCES tickets(id),
  outlet_id       TEXT NOT NULL REFERENCES outlets(id),
  tender_type     TEXT NOT NULL CHECK (tender_type IN ('cash', 'card_credit', 'card_debit', 'gift_card', 'house_account', 'comp', 'doordash_pay', 'ubereats_pay', 'grubhub_pay')),
  amount          NUMERIC(10, 2) NOT NULL,
  tip_amount      NUMERIC(10, 2) NOT NULL DEFAULT 0,
  card_brand      TEXT,           -- visa, mc, amex, discover
  card_last4      TEXT,
  processor_fee   NUMERIC(10, 2) NOT NULL DEFAULT 0,
  captured_at     TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_tenders_ticket ON tenders(ticket_id);
CREATE INDEX idx_tenders_outlet_date ON tenders(outlet_id, captured_at);

-- ════════════════════════════════════════════════════════════════════════
-- LABOR
-- ════════════════════════════════════════════════════════════════════════
CREATE TABLE employees (
  id                  TEXT PRIMARY KEY,
  outlet_id           TEXT NOT NULL REFERENCES outlets(id),
  full_name           TEXT NOT NULL,
  role                TEXT NOT NULL CHECK (role IN ('owner', 'gm', 'exec_chef', 'sous_chef', 'line_cook', 'foh_manager', 'server', 'bartender', 'busser', 'host', 'dishwasher', 'bookkeeper')),
  hourly_wage         NUMERIC(10, 2) NOT NULL,
  tip_eligible        BOOLEAN NOT NULL DEFAULT FALSE,
  hired_on            DATE NOT NULL,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX idx_employees_outlet_role ON employees(outlet_id, role);

CREATE TABLE shifts (
  id                  TEXT PRIMARY KEY,
  outlet_id           TEXT NOT NULL REFERENCES outlets(id),
  employee_id         TEXT NOT NULL REFERENCES employees(id),
  business_day        DATE NOT NULL,
  scheduled_start     TIMESTAMPTZ NOT NULL,
  scheduled_end       TIMESTAMPTZ NOT NULL,
  role_assigned       TEXT NOT NULL,
  section             TEXT
);

CREATE TABLE time_entries (
  id                  BIGSERIAL PRIMARY KEY,
  shift_id            TEXT REFERENCES shifts(id),
  employee_id         TEXT NOT NULL REFERENCES employees(id),
  outlet_id           TEXT NOT NULL REFERENCES outlets(id),
  business_day        DATE NOT NULL,
  clock_in_at         TIMESTAMPTZ NOT NULL,
  clock_out_at        TIMESTAMPTZ,
  break_minutes       INT NOT NULL DEFAULT 0,
  hourly_wage         NUMERIC(10, 2) NOT NULL,
  declared_tips       NUMERIC(10, 2) NOT NULL DEFAULT 0
);

CREATE INDEX idx_time_entries_outlet_day ON time_entries(outlet_id, business_day);

-- ════════════════════════════════════════════════════════════════════════
-- ACCOUNTING — minimal GL: account chart + journal entries
-- ════════════════════════════════════════════════════════════════════════
CREATE TABLE gl_accounts (
  code            TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  account_type    TEXT NOT NULL CHECK (account_type IN ('asset', 'liability', 'equity', 'revenue', 'cogs', 'expense')),
  category        TEXT NOT NULL
);

CREATE TABLE gl_entries (
  id              BIGSERIAL PRIMARY KEY,
  outlet_id       TEXT NOT NULL REFERENCES outlets(id),
  business_day    DATE NOT NULL,
  account_code    TEXT NOT NULL REFERENCES gl_accounts(code),
  debit           NUMERIC(12, 2) NOT NULL DEFAULT 0,
  credit          NUMERIC(12, 2) NOT NULL DEFAULT 0,
  reference       TEXT,
  memo            TEXT,
  posted_at       TIMESTAMPTZ NOT NULL,
  CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))
);

CREATE INDEX idx_gl_entries_outlet_day ON gl_entries(outlet_id, business_day);
CREATE INDEX idx_gl_entries_account_day ON gl_entries(account_code, business_day);

COMMENT ON TABLE gl_entries IS
  'Double-entry journal. Each end-of-day close emits balanced debits/credits per outlet.';

-- Forward-declared FK: tickets.server_id → employees.id.
ALTER TABLE tickets
  ADD CONSTRAINT tickets_server_id_fkey
  FOREIGN KEY (server_id) REFERENCES employees(id);

CREATE INDEX idx_ticket_items_voided ON ticket_items(is_voided) WHERE is_voided = TRUE;
CREATE INDEX idx_ticket_items_comped ON ticket_items(is_comped) WHERE is_comped = TRUE;

COMMIT;

-- ════════════════════════════════════════════════════════════════════════
-- Read-only role for the analytics agent. Idempotent.
-- ════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'arivie_reader') THEN
    CREATE ROLE arivie_reader NOLOGIN;
  END IF;
END$$;

GRANT USAGE ON SCHEMA public TO arivie_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO arivie_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO arivie_reader;
