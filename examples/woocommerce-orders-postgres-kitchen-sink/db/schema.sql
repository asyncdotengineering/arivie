-- SPDX-License-Identifier: Apache-2.0

BEGIN;

DROP TABLE IF EXISTS wc_order_line_item_taxes CASCADE;
DROP TABLE IF EXISTS wc_order_line_item_meta CASCADE;
DROP TABLE IF EXISTS wc_order_line_items CASCADE;
DROP TABLE IF EXISTS wc_order_refunds CASCADE;
DROP TABLE IF EXISTS wc_order_coupon_lines CASCADE;
DROP TABLE IF EXISTS wc_order_fee_lines CASCADE;
DROP TABLE IF EXISTS wc_order_shipping_lines CASCADE;
DROP TABLE IF EXISTS wc_order_taxes CASCADE;
DROP TABLE IF EXISTS wc_order_meta CASCADE;
DROP TABLE IF EXISTS wc_order_addresses CASCADE;
DROP TABLE IF EXISTS wc_orders CASCADE;
DROP TABLE IF EXISTS wc_product_variants CASCADE;
DROP TABLE IF EXISTS wc_products CASCADE;
DROP TABLE IF EXISTS wc_customers CASCADE;
DROP TABLE IF EXISTS wc_sync_state CASCADE;

CREATE TABLE wc_customers (
  customer_id bigint PRIMARY KEY,
  email text,
  first_name text,
  last_name text,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  order_count integer NOT NULL DEFAULT 0,
  raw_last_billing jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_last_shipping jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE wc_orders (
  order_id bigint PRIMARY KEY,
  parent_id bigint,
  number text NOT NULL,
  order_key text NOT NULL,
  created_via text,
  version text,
  status text NOT NULL,
  currency text NOT NULL,
  date_created timestamptz NOT NULL,
  date_modified timestamptz NOT NULL,
  date_paid timestamptz,
  date_completed timestamptz,
  discount_total numeric(18, 6) NOT NULL DEFAULT 0,
  discount_tax numeric(18, 6) NOT NULL DEFAULT 0,
  shipping_total numeric(18, 6) NOT NULL DEFAULT 0,
  shipping_tax numeric(18, 6) NOT NULL DEFAULT 0,
  cart_tax numeric(18, 6) NOT NULL DEFAULT 0,
  total numeric(18, 6) NOT NULL DEFAULT 0,
  total_tax numeric(18, 6) NOT NULL DEFAULT 0,
  prices_include_tax boolean NOT NULL DEFAULT false,
  customer_id bigint,
  customer_ip_address text,
  customer_user_agent text,
  customer_note text,
  payment_method text,
  payment_method_title text,
  transaction_id text,
  cart_hash text,
  raw_order jsonb NOT NULL,
  links jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE wc_order_addresses (
  order_id bigint NOT NULL REFERENCES wc_orders(order_id) ON DELETE CASCADE,
  address_type text NOT NULL CHECK (address_type IN ('billing', 'shipping')),
  first_name text,
  last_name text,
  company text,
  address_1 text,
  address_2 text,
  city text,
  state text,
  postcode text,
  country text,
  email text,
  phone text,
  raw_address jsonb NOT NULL,
  PRIMARY KEY (order_id, address_type)
);

CREATE TABLE wc_order_meta (
  order_id bigint NOT NULL REFERENCES wc_orders(order_id) ON DELETE CASCADE,
  meta_id bigint NOT NULL,
  key text NOT NULL,
  value jsonb,
  raw_meta jsonb NOT NULL,
  PRIMARY KEY (order_id, meta_id)
);

CREATE TABLE wc_products (
  product_id bigint PRIMARY KEY,
  name text NOT NULL,
  sku text,
  product_type text NOT NULL DEFAULT 'simple',
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  raw_last_line_item jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE wc_product_variants (
  product_id bigint NOT NULL REFERENCES wc_products(product_id) ON DELETE CASCADE,
  variation_id bigint NOT NULL,
  sku text,
  name text,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  raw_last_line_item jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (product_id, variation_id)
);

CREATE TABLE wc_order_line_items (
  order_id bigint NOT NULL REFERENCES wc_orders(order_id) ON DELETE CASCADE,
  line_item_id bigint NOT NULL,
  product_id bigint NOT NULL REFERENCES wc_products(product_id),
  variation_id bigint,
  name text NOT NULL,
  sku text,
  quantity integer NOT NULL,
  subtotal numeric(18, 6) NOT NULL DEFAULT 0,
  subtotal_tax numeric(18, 6) NOT NULL DEFAULT 0,
  total numeric(18, 6) NOT NULL DEFAULT 0,
  total_tax numeric(18, 6) NOT NULL DEFAULT 0,
  tax_class text,
  product_type text NOT NULL CHECK (product_type IN ('simple', 'variant')),
  raw_taxes jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_line_item jsonb NOT NULL,
  PRIMARY KEY (order_id, line_item_id),
  FOREIGN KEY (product_id, variation_id) REFERENCES wc_product_variants(product_id, variation_id)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE wc_order_line_item_taxes (
  order_id bigint NOT NULL,
  line_item_id bigint NOT NULL,
  tax_rate_id bigint NOT NULL,
  subtotal numeric(18, 6) NOT NULL DEFAULT 0,
  total numeric(18, 6) NOT NULL DEFAULT 0,
  raw_tax jsonb NOT NULL,
  PRIMARY KEY (order_id, line_item_id, tax_rate_id),
  FOREIGN KEY (order_id, line_item_id) REFERENCES wc_order_line_items(order_id, line_item_id) ON DELETE CASCADE
);

CREATE TABLE wc_order_line_item_meta (
  order_id bigint NOT NULL,
  line_item_id bigint NOT NULL,
  meta_id bigint NOT NULL,
  key text NOT NULL,
  value jsonb,
  display_key text,
  display_value text,
  raw_meta jsonb NOT NULL,
  PRIMARY KEY (order_id, line_item_id, meta_id),
  FOREIGN KEY (order_id, line_item_id) REFERENCES wc_order_line_items(order_id, line_item_id) ON DELETE CASCADE
);

CREATE TABLE wc_order_taxes (
  order_id bigint NOT NULL REFERENCES wc_orders(order_id) ON DELETE CASCADE,
  tax_line_id bigint NOT NULL,
  rate_code text,
  rate_id bigint,
  label text,
  compound boolean NOT NULL DEFAULT false,
  tax_total numeric(18, 6) NOT NULL DEFAULT 0,
  shipping_tax_total numeric(18, 6) NOT NULL DEFAULT 0,
  rate_percent numeric(9, 4),
  raw_tax_line jsonb NOT NULL,
  PRIMARY KEY (order_id, tax_line_id)
);

CREATE TABLE wc_order_shipping_lines (
  order_id bigint NOT NULL REFERENCES wc_orders(order_id) ON DELETE CASCADE,
  shipping_line_id bigint NOT NULL,
  method_title text,
  method_id text,
  instance_id text,
  total numeric(18, 6) NOT NULL DEFAULT 0,
  total_tax numeric(18, 6) NOT NULL DEFAULT 0,
  taxes jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_shipping_line jsonb NOT NULL,
  PRIMARY KEY (order_id, shipping_line_id)
);

CREATE TABLE wc_order_fee_lines (
  order_id bigint NOT NULL REFERENCES wc_orders(order_id) ON DELETE CASCADE,
  fee_line_id bigint NOT NULL,
  name text NOT NULL,
  tax_class text,
  tax_status text,
  total numeric(18, 6) NOT NULL DEFAULT 0,
  total_tax numeric(18, 6) NOT NULL DEFAULT 0,
  taxes jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_fee_line jsonb NOT NULL,
  PRIMARY KEY (order_id, fee_line_id)
);

CREATE TABLE wc_order_coupon_lines (
  order_id bigint NOT NULL REFERENCES wc_orders(order_id) ON DELETE CASCADE,
  coupon_line_id bigint NOT NULL,
  code text NOT NULL,
  discount numeric(18, 6) NOT NULL DEFAULT 0,
  discount_tax numeric(18, 6) NOT NULL DEFAULT 0,
  raw_coupon_line jsonb NOT NULL,
  PRIMARY KEY (order_id, coupon_line_id)
);

CREATE TABLE wc_order_refunds (
  order_id bigint NOT NULL REFERENCES wc_orders(order_id) ON DELETE CASCADE,
  refund_id bigint NOT NULL,
  reason text,
  total numeric(18, 6) NOT NULL DEFAULT 0,
  raw_refund jsonb NOT NULL,
  PRIMARY KEY (order_id, refund_id)
);

CREATE TABLE wc_sync_state (
  source text PRIMARY KEY,
  mode text NOT NULL,
  last_successful_sync_at timestamptz,
  last_seen_date_modified timestamptz,
  last_page integer,
  last_order_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX wc_orders_status_date_created_idx ON wc_orders (status, date_created);
CREATE INDEX wc_orders_date_modified_idx ON wc_orders (date_modified);
CREATE INDEX wc_orders_customer_id_idx ON wc_orders (customer_id);
CREATE INDEX wc_orders_payment_method_idx ON wc_orders (payment_method);
CREATE INDEX wc_order_addresses_country_idx ON wc_order_addresses (address_type, country, state);
CREATE INDEX wc_order_line_items_product_idx ON wc_order_line_items (product_id, variation_id);
CREATE INDEX wc_order_line_items_product_type_idx ON wc_order_line_items (product_type);
CREATE INDEX wc_order_coupon_lines_code_idx ON wc_order_coupon_lines (code);
CREATE INDEX wc_order_refunds_order_idx ON wc_order_refunds (order_id);
CREATE INDEX wc_orders_raw_order_gin_idx ON wc_orders USING gin (raw_order);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'arivie_reader') THEN
    CREATE ROLE arivie_reader;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO arivie_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO arivie_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO arivie_reader;

COMMIT;
