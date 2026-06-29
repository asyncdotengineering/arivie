-- SPDX-License-Identifier: Apache-2.0
-- PGlite-compatible seed for eyewear customer-care example (K1 fixture).

BEGIN;

DROP TABLE IF EXISTS remakes CASCADE;
DROP TABLE IF EXISTS refunds CASCADE;
DROP TABLE IF EXISTS order_items CASCADE;
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS customers CASCADE;

CREATE TABLE customers (
  id bigint PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text NOT NULL
);

CREATE TABLE orders (
  id bigint PRIMARY KEY,
  order_number text NOT NULL UNIQUE,
  customer_id bigint NOT NULL REFERENCES customers(id),
  status text NOT NULL,
  channel text NOT NULL,
  total numeric(12, 2) NOT NULL,
  tax numeric(12, 2) NOT NULL DEFAULT 0,
  shipping numeric(12, 2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL
);

CREATE TABLE order_items (
  id bigint PRIMARY KEY,
  order_id bigint NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_name text NOT NULL,
  frame_sku text NOT NULL,
  lens_type text NOT NULL,
  rx_sphere_od numeric(5, 2),
  rx_cylinder_od numeric(5, 2),
  rx_axis_od integer,
  rx_sphere_os numeric(5, 2),
  rx_cylinder_os numeric(5, 2),
  rx_axis_os integer,
  prescription jsonb NOT NULL DEFAULT '{}'::jsonb,
  quantity integer NOT NULL DEFAULT 1,
  price numeric(12, 2) NOT NULL
);

CREATE TABLE refunds (
  id bigint PRIMARY KEY,
  order_id bigint NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  amount numeric(12, 2) NOT NULL,
  reason text NOT NULL,
  refund_date date NOT NULL
);

CREATE TABLE remakes (
  id bigint PRIMARY KEY,
  order_id bigint NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  reason text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL
);

INSERT INTO customers (id, email, name) VALUES
  (1, 'jane@example.com', 'Jane Doe'),
  (2, 'john@example.com', 'John Smith'),
  (3, 'maria@example.com', 'Maria Garcia');

INSERT INTO orders (id, order_number, customer_id, status, channel, total, tax, shipping, created_at) VALUES
  (101, '1001', 1, 'completed', 'web', 289.00, 23.12, 0.00, '2026-06-10 14:22:00+00'),
  (102, '1002', 2, 'processing', 'web', 415.00, 33.20, 12.00, '2026-06-18 09:05:00+00'),
  (103, '1003', 1, 'refunded', 'web', 198.00, 15.84, 8.00, '2026-06-05 16:40:00+00'),
  (104, '1004', 3, 'completed', 'retail', 520.00, 41.60, 0.00, '2026-06-20 18:15:00+00'),
  (105, '1005', 2, 'pending', 'phone', 175.00, 14.00, 8.00, '2026-06-28 11:30:00+00');

INSERT INTO order_items (id, order_id, product_name, frame_sku, lens_type, rx_sphere_od, rx_cylinder_od, rx_axis_od, rx_sphere_os, rx_cylinder_os, rx_axis_os, prescription, quantity, price) VALUES
  (
    1001, 101, 'Aviator Classic — Progressive', 'LL-AVI-52-BLK', 'progressive',
    -2.25, -0.50, 90, -2.00, -0.75, 85,
    '{"od":{"sphere":-2.25,"cylinder":-0.50,"axis":90},"os":{"sphere":-2.00,"cylinder":-0.75,"axis":85}}'::jsonb,
    1, 289.00
  ),
  (
    1002, 102, 'Round Metal — Blue Light', 'LL-RND-48-GD', 'blue_light',
    -1.50, 0.00, NULL, -1.75, 0.00, NULL,
    '{"od":{"sphere":-1.50,"cylinder":0.00,"axis":null},"os":{"sphere":-1.75,"cylinder":0.00,"axis":null}}'::jsonb,
    1, 403.00
  ),
  (
    1003, 103, 'Cat Eye — Single Vision', 'LL-CAT-50-TOR', 'single_vision',
    -3.00, -1.00, 180, -2.75, -0.75, 175,
    '{"od":{"sphere":-3.00,"cylinder":-1.00,"axis":180},"os":{"sphere":-2.75,"cylinder":-0.75,"axis":175}}'::jsonb,
    1, 190.00
  ),
  (
    1004, 104, 'Titanium Rimless — Progressive', 'LL-TI-54-SLV', 'progressive',
    +1.25, -0.25, 10, +1.50, -0.50, 170,
    '{"od":{"sphere":1.25,"cylinder":-0.25,"axis":10},"os":{"sphere":1.50,"cylinder":-0.50,"axis":170}}'::jsonb,
    1, 520.00
  ),
  (
    1005, 105, 'Readers — +2.00', 'LL-RD-50-CLR', 'readers',
    2.00, 0.00, NULL, 2.00, 0.00, NULL,
    '{"od":{"sphere":2.00,"cylinder":0.00,"axis":null},"os":{"sphere":2.00,"cylinder":0.00,"axis":null}}'::jsonb,
    1, 175.00
  );

INSERT INTO refunds (id, order_id, amount, reason, refund_date) VALUES
  (501, 103, 174.16, 'rx_not_tolerated', '2026-06-12');

INSERT INTO remakes (id, order_id, reason, status, created_at) VALUES
  (601, 102, 'wrong_prescription', 'in_production', '2026-06-19 10:00:00+00');

COMMIT;