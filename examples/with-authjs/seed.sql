-- SPDX-License-Identifier: Apache-2.0
-- examples/with-nextjs seed — covers all 5 semantic-layer entities:
-- customers, products, orders, line_items, invoices.
-- Designed for live LLM demo runs (Gemini / Anthropic / OpenAI).

BEGIN;

DROP TABLE IF EXISTS line_items;
DROP TABLE IF EXISTS invoices;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS customers;

-- ────────────────────────────────────────────────────────────────
-- customers (10 rows)
-- ────────────────────────────────────────────────────────────────
CREATE TABLE customers (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL,
  country     TEXT NOT NULL CHECK (country IN ('US', 'GB', 'DE', 'FR', 'NL', 'CA', 'AU'))
);

INSERT INTO customers (id, email, created_at, country) VALUES
  ('cust-01', 'amelia.warren@example.com',    '2025-08-12 09:00:00+00', 'US'),
  ('cust-02', 'lukas.brand@example.de',       '2025-09-05 10:00:00+00', 'DE'),
  ('cust-03', 'olivia.kerr@example.co.uk',    '2025-09-20 11:00:00+00', 'GB'),
  ('cust-04', 'noah.bennett@example.com',     '2025-10-02 12:00:00+00', 'US'),
  ('cust-05', 'sofia.romero@example.com',     '2025-10-15 13:00:00+00', 'US'),
  ('cust-06', 'kai.thompson@example.com.au',  '2025-11-01 14:00:00+00', 'AU'),
  ('cust-07', 'amy.lefebvre@example.fr',      '2025-11-18 15:00:00+00', 'FR'),
  ('cust-08', 'rohan.singh@example.ca',       '2026-01-08 16:00:00+00', 'CA'),
  ('cust-09', 'mira.jansen@example.nl',       '2026-02-22 17:00:00+00', 'NL'),
  ('cust-10', 'liam.holt@example.co.uk',      '2026-03-10 18:00:00+00', 'GB');

-- ────────────────────────────────────────────────────────────────
-- products (12 rows)
-- ────────────────────────────────────────────────────────────────
CREATE TABLE products (
  id          SERIAL PRIMARY KEY,
  sku         TEXT NOT NULL UNIQUE,
  category    TEXT NOT NULL CHECK (category IN ('apparel', 'electronics', 'home', 'books', 'beauty')),
  list_price  NUMERIC(10, 2) NOT NULL
);

INSERT INTO products (sku, category, list_price) VALUES
  ('SKU-A-101', 'apparel',     49.99),
  ('SKU-A-102', 'apparel',     89.50),
  ('SKU-A-103', 'apparel',     34.99),
  ('SKU-E-201', 'electronics', 249.00),
  ('SKU-E-202', 'electronics', 119.95),
  ('SKU-E-203', 'electronics', 599.00),
  ('SKU-H-301', 'home',        29.99),
  ('SKU-H-302', 'home',        159.00),
  ('SKU-B-401', 'books',       18.50),
  ('SKU-B-402', 'books',       24.00),
  ('SKU-Y-501', 'beauty',      42.00),
  ('SKU-Y-502', 'beauty',      75.00);

-- ────────────────────────────────────────────────────────────────
-- orders (re-seeded; identical schema to scripts/seed-dogfood.sql so
-- the existing per-mode eval can also point at this DB.)
-- ────────────────────────────────────────────────────────────────
CREATE TABLE orders (
  id            SERIAL PRIMARY KEY,
  customer_id   TEXT NOT NULL REFERENCES customers(id),
  status        TEXT NOT NULL CHECK (
                  status IN ('pending', 'processing', 'completed', 'refunded', 'cancelled', 'draft')
                ),
  created_at    TIMESTAMPTZ NOT NULL,
  total_amount  NUMERIC(12, 2) NOT NULL,
  amount_paid   NUMERIC(12, 2) NOT NULL DEFAULT 0,
  currency      TEXT NOT NULL CHECK (currency IN ('USD', 'EUR', 'GBP')),
  due_date      DATE
);

INSERT INTO orders (customer_id, status, created_at, total_amount, amount_paid, currency, due_date) VALUES
  ('cust-01', 'completed',  '2025-11-05 10:00:00+00', 1200.00, 1200.00, 'USD', '2025-11-20'),
  ('cust-02', 'completed',  '2025-11-12 11:00:00+00',  850.50,  850.50, 'EUR', '2025-11-28'),
  ('cust-03', 'refunded',   '2025-11-18 09:00:00+00',  400.00,    0.00, 'USD', '2025-12-01'),
  ('cust-01', 'cancelled',  '2025-11-22 14:00:00+00',  300.00,    0.00, 'USD', NULL),
  ('cust-04', 'draft',      '2025-11-25 16:00:00+00',  150.00,    0.00, 'GBP', NULL),
  ('cust-02', 'completed',  '2025-12-03 08:00:00+00', 2200.00, 2200.00, 'EUR', '2025-12-18'),
  ('cust-05', 'completed',  '2025-12-10 12:00:00+00',  990.00,  990.00, 'USD', '2025-12-25'),
  ('cust-03', 'completed',  '2025-12-15 13:00:00+00', 1750.25, 1750.25, 'GBP', '2025-12-30'),
  ('cust-06', 'refunded',   '2025-12-20 10:00:00+00',  620.00,    0.00, 'USD', '2026-01-05'),
  ('cust-01', 'processing', '2025-12-28 15:00:00+00',  500.00,  200.00, 'USD', '2026-01-10'),
  ('cust-04', 'completed',  '2026-01-08 09:00:00+00', 3100.00, 3100.00, 'USD', '2026-01-23'),
  ('cust-02', 'completed',  '2026-01-14 11:00:00+00', 1450.00, 1450.00, 'EUR', '2026-01-29'),
  ('cust-07', 'refunded',   '2026-01-20 10:00:00+00',  275.50,    0.00, 'GBP', '2026-02-01'),
  ('cust-05', 'refunded',   '2026-01-25 14:00:00+00',  890.00,    0.00, 'USD', '2026-02-08'),
  ('cust-08', 'pending',    '2026-01-30 16:00:00+00',  720.00,    0.00, 'USD', '2026-02-14'),
  ('cust-01', 'completed',  '2026-02-04 10:00:00+00', 1800.00, 1800.00, 'USD', '2026-02-19'),
  ('cust-03', 'completed',  '2026-02-11 12:00:00+00',  640.00,  640.00, 'GBP', '2026-02-26'),
  ('cust-09', 'completed',  '2026-02-25 09:00:00+00',  430.00,  430.00, 'EUR', '2026-03-12'),
  ('cust-10', 'pending',    '2026-03-04 10:00:00+00', 1320.00,    0.00, 'GBP', '2026-03-19'),
  ('cust-04', 'completed',  '2026-03-11 11:00:00+00', 1075.00, 1075.00, 'USD', '2026-03-26'),
  ('cust-02', 'completed',  '2026-04-02 09:00:00+00',  920.00,  920.00, 'EUR', '2026-04-17'),
  ('cust-06', 'completed',  '2026-04-10 13:00:00+00', 2410.00, 2410.00, 'USD', '2026-04-25'),
  ('cust-01', 'pending',    '2026-04-18 10:00:00+00',  555.00,  100.00, 'USD', '2026-05-03'),
  ('cust-05', 'completed',  '2026-05-08 11:00:00+00', 1425.00, 1425.00, 'USD', '2026-05-23'),
  ('cust-02', 'completed',  '2026-05-12 14:00:00+00',  760.00,  760.00, 'EUR', '2026-05-27'),
  ('cust-03', 'pending',    '2026-05-14 09:00:00+00',  950.00,    0.00, 'GBP', '2026-04-30'),
  ('cust-10', 'pending',    '2026-05-15 10:00:00+00', 1100.00,  250.00, 'EUR', '2026-04-15'),
  ('cust-06', 'pending',    '2026-04-01 08:00:00+00', 2000.00,  500.00, 'USD', '2026-04-10'),
  ('cust-07', 'processing', '2026-03-15 12:00:00+00', 1650.00,  400.00, 'GBP', '2026-03-25'),
  ('cust-08', 'processing', '2026-02-20 10:00:00+00',  980.00,    0.00, 'USD', '2026-03-01'),
  ('cust-09', 'pending',    '2026-05-01 09:00:00+00',  540.00,    0.00, 'EUR', '2026-05-05');

-- ────────────────────────────────────────────────────────────────
-- line_items (60+ rows; ~2-3 per order on the completed/processing set)
-- ────────────────────────────────────────────────────────────────
CREATE TABLE line_items (
  id          SERIAL PRIMARY KEY,
  order_id    INTEGER NOT NULL REFERENCES orders(id),
  product_id  INTEGER NOT NULL REFERENCES products(id),
  quantity    INTEGER NOT NULL CHECK (quantity > 0),
  unit_price  NUMERIC(10, 2) NOT NULL
);

INSERT INTO line_items (order_id, product_id, quantity, unit_price)
SELECT
  o.id,
  p.id,
  ((o.id * 13 + p.id * 7) % 4) + 1,                              -- 1..4 quantity
  ROUND(p.list_price * (0.85 + ((o.id * 31 + p.id * 17) % 30)::numeric / 100), 2)  -- ~85%..115% of list
FROM orders o
JOIN LATERAL (
  -- 2 deterministic products per order
  SELECT id, list_price FROM products WHERE id IN (
    ((o.id * 5)  % 12) + 1,
    ((o.id * 11) % 12) + 1
  )
) p ON true
WHERE o.status NOT IN ('draft', 'cancelled');                    -- skip non-fulfilled orders

-- ────────────────────────────────────────────────────────────────
-- invoices (one per completed/processing/pending order)
-- ────────────────────────────────────────────────────────────────
CREATE TABLE invoices (
  id            SERIAL PRIMARY KEY,
  customer_id   TEXT NOT NULL REFERENCES customers(id),
  amount        NUMERIC(12, 2) NOT NULL,
  amount_paid   NUMERIC(12, 2) NOT NULL DEFAULT 0,
  status        TEXT NOT NULL CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'void')),
  issued_at     TIMESTAMPTZ NOT NULL
);

INSERT INTO invoices (customer_id, amount, amount_paid, status, issued_at)
SELECT
  o.customer_id,
  o.total_amount,
  o.amount_paid,
  CASE
    WHEN o.status = 'completed'                         THEN 'paid'
    WHEN o.status = 'refunded'                          THEN 'void'
    WHEN o.status = 'cancelled'                         THEN 'void'
    WHEN o.status IN ('pending', 'processing')
      AND o.due_date IS NOT NULL
      AND o.due_date < CURRENT_DATE                     THEN 'overdue'
    WHEN o.status IN ('pending', 'processing')          THEN 'sent'
    ELSE 'draft'
  END,
  o.created_at
FROM orders o;

COMMIT;

-- Sanity counts
SELECT
  (SELECT COUNT(*) FROM customers) AS customers,
  (SELECT COUNT(*) FROM products)  AS products,
  (SELECT COUNT(*) FROM orders)    AS orders,
  (SELECT COUNT(*) FROM line_items) AS line_items,
  (SELECT COUNT(*) FROM invoices)  AS invoices;
