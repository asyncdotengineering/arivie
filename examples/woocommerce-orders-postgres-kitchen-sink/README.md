# WooCommerce Orders Postgres Kitchen Sink

This is a production-ready Arivie example for a WooCommerce merchant that wants to sync orders into Postgres for analytics, fulfillment, finance reconciliation, and customer reporting.

The agent runs against Postgres in both local mock mode and live WooCommerce mode. The only source flip is `WOOCOMMERCE_MODE=mock|live`; Arivie always reads the same normalized Postgres schema.

## What This Demonstrates

- WooCommerce Orders REST API payload shape as the ingestion source.
- Mock-by-default order sync with realistic WooCommerce order JSON.
- Optional live sync from `/wp-json/wc/v3/orders` using WooCommerce consumer credentials.
- Idempotent upserts keyed by WooCommerce IDs.
- Backfill and incremental sync using `wc_sync_state.last_seen_date_modified`.
- Raw order JSON preservation in `wc_orders.raw_order`.
- Normalized Postgres tables for order headers, customers, addresses, products, variants, line items, taxes, shipping, fees, coupons, refunds, and metadata.
- Decimal-safe money columns using `numeric(18, 6)`.
- Nullable/optional nested arrays handled safely.
- Arivie Postgres source/storage, semantic YAML, skills, schedules, hooks, local workspace, `compileMetric`, API server, and CLI chat.

## Use Case

A WooCommerce merchant asks questions such as:

- What was net revenue last month?
- Which products drove the most gross sales?
- How much revenue came from product variants versus simple products?
- Which coupons reduced revenue the most?
- What is refund-adjusted revenue by week?
- Which countries or regions produced the most sales?
- What is average order value by payment method?
- Which products have high refund rates?
- What were shipping fees and tax collected by month?
- Which customers placed repeat orders?
- How did completed, processing, refunded, failed, and cancelled orders trend over time?

## Source Payload Shape

The source shape matches the WooCommerce Orders endpoint response. The sample payloads in `scripts/sample-orders.ts` include fields such as:

- `id`, `parent_id`, `number`, `order_key`, `created_via`, `version`, `status`, `currency`
- `date_created`, `date_modified`, `date_paid`, `date_completed`
- `discount_total`, `discount_tax`, `shipping_total`, `shipping_tax`, `cart_tax`, `total`, `total_tax`, `prices_include_tax`
- `customer_id`, `customer_ip_address`, `customer_user_agent`, `customer_note`
- `billing`, `shipping`
- `payment_method`, `payment_method_title`, `transaction_id`, `cart_hash`
- `meta_data`, `line_items`, `tax_lines`, `shipping_lines`, `fee_lines`, `coupon_lines`, `refunds`, `_links`

Unknown and plugin-specific fields remain available through JSONB columns such as `wc_orders.raw_order`, `wc_order_line_items.raw_line_item`, and metadata tables.

## PostgreSQL Tables

The schema is in `db/schema.sql` and creates:

- `wc_orders`
- `wc_order_addresses`
- `wc_order_line_items`
- `wc_order_line_item_taxes`
- `wc_order_line_item_meta`
- `wc_order_taxes`
- `wc_order_shipping_lines`
- `wc_order_fee_lines`
- `wc_order_coupon_lines`
- `wc_order_refunds`
- `wc_order_meta`
- `wc_products`
- `wc_product_variants`
- `wc_customers`
- `wc_sync_state`

The schema uses primary keys and foreign keys based on WooCommerce IDs where practical. The sync deletes and reinserts nested child rows per order inside a transaction while upserting stable parent rows, making reruns safe.

## Products And Variants

Line items preserve:

- `product_id`
- `variation_id`
- `sku`
- product name
- quantity
- subtotal, subtotal tax, total, total tax
- tax class
- taxes array
- line item metadata
- raw line item JSON

`variation_id > 0` is treated as a variant and stored in `wc_product_variants` keyed by `(product_id, variation_id)`. `variation_id = 0`, `null`, or missing is treated as a simple product and stored with `product_type = 'simple'` on line items.

Variation attributes are extracted from line-item metadata keys such as `pa_color` and `pa_size` into `wc_product_variants.attributes`, while the raw metadata stays in `wc_order_line_item_meta`.

## Setup

From the repo root:

```bash
pnpm install
```

Start Postgres with Docker Compose, or use your own local Postgres:

```bash
docker compose -f examples/woocommerce-orders-postgres-kitchen-sink/docker-compose.yml up -d
```

Create `.env.local` if needed:

```bash
cp examples/woocommerce-orders-postgres-kitchen-sink/.env.example examples/woocommerce-orders-postgres-kitchen-sink/.env.local
```

Default local values:

```bash
DATABASE_URL=postgresql://localhost:5432/arivie_woocommerce_orders
WOOCOMMERCE_MODE=mock
```

Initialize the database and schema:

```bash
pnpm --filter @arivie/example-woocommerce-orders-postgres-kitchen-sink setup-db
```

Sync mock WooCommerce orders into Postgres:

```bash
pnpm --filter @arivie/example-woocommerce-orders-postgres-kitchen-sink sync
```

Validate normalization:

```bash
pnpm --filter @arivie/example-woocommerce-orders-postgres-kitchen-sink validate
```

Run deterministic SQL summaries without an LLM key:

```bash
pnpm --filter @arivie/example-woocommerce-orders-postgres-kitchen-sink dry-run
```

## Live WooCommerce Sync

The agent stays the same. Only the ingestion source changes:

```bash
WOOCOMMERCE_MODE=live
WOOCOMMERCE_STORE_URL=https://your-store.example
WOOCOMMERCE_CONSUMER_KEY=ck_...
WOOCOMMERCE_CONSUMER_SECRET=cs_...
```

Then run:

```bash
pnpm --filter @arivie/example-woocommerce-orders-postgres-kitchen-sink sync
```

Incremental sync uses `modified_after` in live mode and `wc_sync_state.last_seen_date_modified` in both modes:

```bash
pnpm --filter @arivie/example-woocommerce-orders-postgres-kitchen-sink sync:incremental
```

## Run The Agent

Set `OPENAI_API_KEY`, then start the production API surface:

```bash
pnpm --filter @arivie/example-woocommerce-orders-postgres-kitchen-sink api
```

Call the app-facing chat endpoint:

```bash
curl -X POST http://localhost:3000/chat \
  -H 'content-type: application/json' \
  -d '{"message":"Compare simple products vs variant products by revenue and units sold.","conversationId":"merchant:daily","userId":"merchant-owner"}'
```

Or use the CLI client:

```bash
pnpm --filter @arivie/example-woocommerce-orders-postgres-kitchen-sink chat -- --api http://localhost:3000
```

Run the scripted Arivie prompt suite:

```bash
pnpm --filter @arivie/example-woocommerce-orders-postgres-kitchen-sink demo
```

## Example Questions

- “Show net sales by week for the last 90 days.”
- “Which product variants drove the most revenue?”
- “Compare simple products vs variant products by revenue and units sold.”
- “Which coupons had the biggest impact on revenue?”
- “What is refund-adjusted revenue by month?”
- “Which customers are repeat purchasers?”
- “Write a Markdown sales report for the last 30 days.”

Expected behavior: the agent should query the normalized Postgres tables, use line-item totals for product/variant questions, use order totals for order-level AOV/payment/status questions, and clearly state whether taxes, shipping, discounts, and refunds are included.

## Arivie Features Demonstrated

- `defineArivie` production config.
- Postgres adapter as `storage` and read-only `source`.
- Semantic YAML entities, measures, dimensions, segments, joins, and hints.
- SOP skills under `skills/`.
- `skillsMode: "auto"`.
- `compileMetric: true`.
- `defineSchedules` for daily and weekly merchant reporting.
- Lifecycle hooks for query/tool/memory logging.
- Local workspace support.
- API-first Hono server using `createArivieServer()`.
- CLI chat client over API or in-process mode.
- Node build target via `arivie build --target node`.

## Known Limitations

- The example syncs the Orders endpoint only. Product catalog enrichment from the Products endpoint is intentionally not included because the requested source is the Orders API response.
- Refund line-item detail is limited to the refund references included in the Orders response. Full refund objects can be fetched from WooCommerce refund endpoints if a production deployment needs item-level refund allocations.
- Live mode uses WooCommerce basic auth over HTTPS with consumer key/secret. OAuth and application passwords are store-specific deployment choices.
