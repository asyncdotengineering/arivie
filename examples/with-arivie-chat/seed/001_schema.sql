-- SPDX-License-Identifier: Apache-2.0
-- Synthetic e-commerce schema bundled with the Arivie chat starter.
-- A real deployment replaces this with its own DB; this exists so the
-- chat boots with answerable analytics questions on first install.

CREATE TABLE IF NOT EXISTS customers (
  id          text PRIMARY KEY,
  email       text NOT NULL UNIQUE,
  name        text NOT NULL,
  country     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  category    text NOT NULL,
  price       numeric(10, 2) NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id            text PRIMARY KEY,
  customer_id   text NOT NULL REFERENCES customers(id),
  status        text NOT NULL CHECK (status IN ('pending','completed','cancelled','refunded')),
  total_amount  numeric(10, 2) NOT NULL,
  created_at    timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS orders_customer_idx ON orders(customer_id);
CREATE INDEX IF NOT EXISTS orders_created_idx ON orders(created_at);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders(status);

CREATE TABLE IF NOT EXISTS order_items (
  id          text PRIMARY KEY,
  order_id    text NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id  text NOT NULL REFERENCES products(id),
  quantity    integer NOT NULL CHECK (quantity > 0),
  unit_price  numeric(10, 2) NOT NULL,
  subtotal    numeric(10, 2) NOT NULL
);
CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items(order_id);
CREATE INDEX IF NOT EXISTS order_items_product_idx ON order_items(product_id);

-- Grant the read-only role SELECT on the new tables. Idempotent.
-- Postgres 16+ (Neon) needs WITH SET TRUE on role membership so the
-- session owner can SET ROLE arivie_reader at runtime — the default
-- since 16 is INHERIT TRUE / SET FALSE.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'arivie_reader') THEN
    GRANT USAGE ON SCHEMA public TO arivie_reader;
    GRANT SELECT ON customers, products, orders, order_items TO arivie_reader;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT SELECT ON TABLES TO arivie_reader;
    EXECUTE format(
      'GRANT arivie_reader TO %I WITH SET TRUE',
      current_user
    );
  END IF;
END $$;
