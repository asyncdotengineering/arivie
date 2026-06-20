DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'arivie_reader') THEN
    CREATE ROLE arivie_reader LOGIN;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS arivie_owner_identity (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO arivie_owner_identity (key, value)
VALUES ('owner_id', 'northstar-hospitality')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

DROP TABLE IF EXISTS close_events;
DROP TABLE IF EXISTS ticket_items;
DROP TABLE IF EXISTS tickets;
DROP TABLE IF EXISTS menu_items;
DROP TABLE IF EXISTS outlets;

CREATE TABLE outlets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  concept TEXT NOT NULL
);

CREATE TABLE menu_items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  theoretical_cost NUMERIC(10,2) NOT NULL,
  price NUMERIC(10,2) NOT NULL
);

CREATE TABLE tickets (
  id TEXT PRIMARY KEY,
  outlet_id TEXT NOT NULL REFERENCES outlets(id),
  business_day DATE NOT NULL,
  service_type TEXT NOT NULL,
  channel TEXT NOT NULL,
  status TEXT NOT NULL,
  guest_count INTEGER NOT NULL,
  subtotal NUMERIC(10,2) NOT NULL,
  discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  comp_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  void_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  tip_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  opened_at TIMESTAMPTZ NOT NULL,
  closed_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE ticket_items (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id),
  menu_item_id TEXT NOT NULL REFERENCES menu_items(id),
  qty INTEGER NOT NULL,
  line_subtotal NUMERIC(10,2) NOT NULL,
  is_voided BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE close_events (
  id TEXT PRIMARY KEY,
  outlet_id TEXT NOT NULL REFERENCES outlets(id),
  business_day DATE NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO outlets (id, name, city, concept) VALUES
  ('bistro', 'Northstar Bistro', 'Austin', 'full_service'),
  ('market', 'Northstar Market', 'Austin', 'fast_casual'),
  ('bar', 'Northstar Bar', 'Austin', 'bar_late_night');

INSERT INTO menu_items (id, name, category, theoretical_cost, price) VALUES
  ('steak-frites', 'Steak Frites', 'food', 14.50, 34.00),
  ('salmon-bowl', 'Salmon Bowl', 'food', 8.75, 22.00),
  ('market-salad', 'Market Salad', 'food', 4.25, 14.00),
  ('house-cocktail', 'House Cocktail', 'alcohol', 3.10, 15.00),
  ('espresso-tonic', 'Espresso Tonic', 'beverage', 1.90, 8.00);

INSERT INTO tickets (id, outlet_id, business_day, service_type, channel, status, guest_count, subtotal, discount_amount, comp_amount, void_amount, tax_amount, tip_amount, opened_at, closed_at) VALUES
  ('t-001', 'bistro', CURRENT_DATE - INTERVAL '1 day', 'dine_in', 'walk_in', 'closed', 4, 148.00, 0, 0, 0, 12.21, 29.60, now() - INTERVAL '26 hours', now() - INTERVAL '25 hours'),
  ('t-002', 'bistro', CURRENT_DATE - INTERVAL '1 day', 'dine_in', 'walk_in', 'closed', 2, 68.00, 0, 10.00, 0, 4.79, 11.60, now() - INTERVAL '25 hours', now() - INTERVAL '24 hours'),
  ('t-003', 'market', CURRENT_DATE - INTERVAL '1 day', 'takeout', 'own_app', 'closed', 1, 22.00, 2.00, 0, 0, 1.65, 0, now() - INTERVAL '23 hours', now() - INTERVAL '23 hours'),
  ('t-004', 'market', CURRENT_DATE - INTERVAL '2 days', 'delivery', 'doordash', 'closed', 1, 44.00, 0, 0, 0, 3.63, 0, now() - INTERVAL '47 hours', now() - INTERVAL '47 hours'),
  ('t-005', 'bar', CURRENT_DATE - INTERVAL '1 day', 'bar', 'walk_in', 'closed', 3, 75.00, 0, 0, 0, 6.19, 18.00, now() - INTERVAL '21 hours', now() - INTERVAL '20 hours'),
  ('t-006', 'bar', CURRENT_DATE - INTERVAL '1 day', 'bar', 'walk_in', 'voided', 1, 15.00, 0, 0, 15.00, 0, 0, now() - INTERVAL '20 hours', now() - INTERVAL '20 hours'),
  ('t-007', 'bistro', CURRENT_DATE - INTERVAL '6 days', 'dine_in', 'walk_in', 'closed', 2, 83.00, 0, 0, 0, 6.85, 16.60, now() - INTERVAL '6 days', now() - INTERVAL '6 days'),
  ('t-008', 'market', CURRENT_DATE - INTERVAL '5 days', 'takeout', 'phone', 'closed', 2, 36.00, 0, 0, 0, 2.97, 0, now() - INTERVAL '5 days', now() - INTERVAL '5 days');

INSERT INTO ticket_items (id, ticket_id, menu_item_id, qty, line_subtotal, is_voided) VALUES
  ('ti-001', 't-001', 'steak-frites', 2, 68.00, false),
  ('ti-002', 't-001', 'house-cocktail', 4, 60.00, false),
  ('ti-003', 't-001', 'market-salad', 1, 14.00, false),
  ('ti-004', 't-002', 'salmon-bowl', 2, 44.00, false),
  ('ti-005', 't-002', 'house-cocktail', 1, 15.00, false),
  ('ti-006', 't-003', 'salmon-bowl', 1, 22.00, false),
  ('ti-007', 't-004', 'market-salad', 2, 28.00, false),
  ('ti-008', 't-005', 'house-cocktail', 5, 75.00, false),
  ('ti-009', 't-006', 'house-cocktail', 1, 15.00, true),
  ('ti-010', 't-007', 'steak-frites', 1, 34.00, false),
  ('ti-011', 't-007', 'house-cocktail', 3, 45.00, false),
  ('ti-012', 't-008', 'market-salad', 2, 28.00, false),
  ('ti-013', 't-008', 'espresso-tonic', 1, 8.00, false);

INSERT INTO close_events (id, outlet_id, business_day, event_type, payload) VALUES
  ('close-001', 'bar', CURRENT_DATE - INTERVAL '1 day', 'void_rate_breach', '{"void_pct":20.0,"threshold":2.0}'::jsonb);

GRANT USAGE ON SCHEMA public TO arivie_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO arivie_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO arivie_reader;
