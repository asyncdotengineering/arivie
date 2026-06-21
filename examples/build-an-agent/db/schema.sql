-- Northwind Analytics — tutorial schema. A storefront: customers + orders.

CREATE TABLE IF NOT EXISTS customers (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  plan         TEXT NOT NULL DEFAULT 'free',     -- free | pro | enterprise
  signed_up_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id           SERIAL PRIMARY KEY,
  customer_id  INTEGER NOT NULL REFERENCES customers(id),
  status       TEXT NOT NULL DEFAULT 'paid',     -- paid | refunded | pending
  amount_cents INTEGER NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Read-only role the agent's SQL runs as (least privilege).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'arivie_reader') THEN
    CREATE ROLE arivie_reader NOLOGIN;
  END IF;
END$$;
GRANT USAGE ON SCHEMA public TO arivie_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO arivie_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO arivie_reader;
