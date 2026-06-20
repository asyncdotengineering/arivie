/* SPDX-License-Identifier: Apache-2.0 */
import postgres from "postgres";
import { loadEnv } from "./env.js";
import { sampleOrders, type WooCommerceOrder } from "./sample-orders.js";

loadEnv();

const args = new Set(process.argv.slice(2));
const mode = args.has("--mode") ? process.argv[process.argv.indexOf("--mode") + 1] ?? "backfill" : "backfill";
const source = process.env.WOOCOMMERCE_MODE === "live" ? "woocommerce-live" : "woocommerce-mock";

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function int(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Number.parseInt(String(value ?? 0), 10) || 0;
}

function money(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return value.toFixed(6);
  if (typeof value === "string" && value.length > 0) return value;
  return "0";
}

function timestamp(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function json(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function array(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => item != null && typeof item === "object" && !Array.isArray(item)) : [];
}

function object(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function metaValue(value: unknown): string {
  return json(value ?? null);
}

function variationAttributes(metaData: Array<Record<string, unknown>>): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};
  for (const meta of metaData) {
    const key = text(meta.key);
    if (key?.startsWith("pa_")) attrs[key.replace(/^pa_/, "")] = meta.value ?? null;
  }
  return attrs;
}

async function fetchOrdersFromWooCommerce(after?: string): Promise<WooCommerceOrder[]> {
  const storeUrl = process.env.WOOCOMMERCE_STORE_URL;
  const consumerKey = process.env.WOOCOMMERCE_CONSUMER_KEY;
  const consumerSecret = process.env.WOOCOMMERCE_CONSUMER_SECRET;
  if (!storeUrl || !consumerKey || !consumerSecret) {
    throw new Error("Live mode requires WOOCOMMERCE_STORE_URL, WOOCOMMERCE_CONSUMER_KEY, and WOOCOMMERCE_CONSUMER_SECRET");
  }

  const orders: WooCommerceOrder[] = [];
  for (let page = 1; ; page += 1) {
    const url = new URL("/wp-json/wc/v3/orders", storeUrl);
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));
    url.searchParams.set("orderby", "modified");
    url.searchParams.set("order", "asc");
    if (after) url.searchParams.set("modified_after", after);

    const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");
    const response = await fetch(url, { headers: { authorization: `Basic ${auth}` } });
    if (!response.ok) throw new Error(`WooCommerce request failed: ${response.status} ${await response.text()}`);
    const pageOrders = await response.json() as WooCommerceOrder[];
    orders.push(...pageOrders);
    const totalPages = Number(response.headers.get("x-wp-totalpages") ?? "1");
    if (page >= totalPages || pageOrders.length === 0) break;
  }
  return orders;
}

async function loadOrders(sql: postgres.Sql): Promise<WooCommerceOrder[]> {
  const [state] = await sql<{ last_seen_date_modified: Date | null }[]>`
    SELECT last_seen_date_modified FROM wc_sync_state WHERE source = ${source}
  `;
  const after = mode === "incremental" ? state?.last_seen_date_modified?.toISOString() : undefined;
  if (process.env.WOOCOMMERCE_MODE === "live") return fetchOrdersFromWooCommerce(after);
  return after == null ? sampleOrders : sampleOrders.filter((order) => new Date(order.date_modified) > new Date(after));
}

async function upsertOrder(sql: postgres.TransactionSql, order: WooCommerceOrder): Promise<void> {
  const billing = object(order.billing);
  const shipping = object(order.shipping);
  const customerId = int(order.customer_id);

  if (customerId > 0) {
    await sql`
      INSERT INTO wc_customers (customer_id, email, first_name, last_name, first_seen_at, last_seen_at, order_count, raw_last_billing, raw_last_shipping)
      VALUES (${customerId}, ${text(billing.email)}, ${text(billing.first_name)}, ${text(billing.last_name)}, ${timestamp(order.date_created)}, ${timestamp(order.date_created)}, 1, ${json(billing)}, ${json(shipping)})
      ON CONFLICT (customer_id) DO UPDATE SET
        email = COALESCE(EXCLUDED.email, wc_customers.email),
        first_name = COALESCE(EXCLUDED.first_name, wc_customers.first_name),
        last_name = COALESCE(EXCLUDED.last_name, wc_customers.last_name),
        first_seen_at = LEAST(wc_customers.first_seen_at, EXCLUDED.first_seen_at),
        last_seen_at = GREATEST(wc_customers.last_seen_at, EXCLUDED.last_seen_at),
        raw_last_billing = EXCLUDED.raw_last_billing,
        raw_last_shipping = EXCLUDED.raw_last_shipping,
        updated_at = now()
    `;
  }

  await sql`
    INSERT INTO wc_orders (
      order_id, parent_id, number, order_key, created_via, version, status, currency,
      date_created, date_modified, date_paid, date_completed, discount_total, discount_tax,
      shipping_total, shipping_tax, cart_tax, total, total_tax, prices_include_tax, customer_id,
      customer_ip_address, customer_user_agent, customer_note, payment_method, payment_method_title,
      transaction_id, cart_hash, raw_order, links, synced_at
    ) VALUES (
      ${order.id}, ${int(order.parent_id)}, ${order.number}, ${order.order_key}, ${text(order.created_via)}, ${text(order.version)}, ${order.status}, ${order.currency},
      ${timestamp(order.date_created)}, ${timestamp(order.date_modified)}, ${timestamp(order.date_paid)}, ${timestamp(order.date_completed)}, ${money(order.discount_total)}, ${money(order.discount_tax)},
      ${money(order.shipping_total)}, ${money(order.shipping_tax)}, ${money(order.cart_tax)}, ${money(order.total)}, ${money(order.total_tax)}, ${Boolean(order.prices_include_tax)}, ${customerId > 0 ? customerId : null},
      ${text(order.customer_ip_address)}, ${text(order.customer_user_agent)}, ${text(order.customer_note)}, ${text(order.payment_method)}, ${text(order.payment_method_title)},
      ${text(order.transaction_id)}, ${text(order.cart_hash)}, ${json(order)}, ${json(order._links)}, now()
    ) ON CONFLICT (order_id) DO UPDATE SET
      parent_id = EXCLUDED.parent_id,
      number = EXCLUDED.number,
      order_key = EXCLUDED.order_key,
      created_via = EXCLUDED.created_via,
      version = EXCLUDED.version,
      status = EXCLUDED.status,
      currency = EXCLUDED.currency,
      date_created = EXCLUDED.date_created,
      date_modified = EXCLUDED.date_modified,
      date_paid = EXCLUDED.date_paid,
      date_completed = EXCLUDED.date_completed,
      discount_total = EXCLUDED.discount_total,
      discount_tax = EXCLUDED.discount_tax,
      shipping_total = EXCLUDED.shipping_total,
      shipping_tax = EXCLUDED.shipping_tax,
      cart_tax = EXCLUDED.cart_tax,
      total = EXCLUDED.total,
      total_tax = EXCLUDED.total_tax,
      prices_include_tax = EXCLUDED.prices_include_tax,
      customer_id = EXCLUDED.customer_id,
      customer_ip_address = EXCLUDED.customer_ip_address,
      customer_user_agent = EXCLUDED.customer_user_agent,
      customer_note = EXCLUDED.customer_note,
      payment_method = EXCLUDED.payment_method,
      payment_method_title = EXCLUDED.payment_method_title,
      transaction_id = EXCLUDED.transaction_id,
      cart_hash = EXCLUDED.cart_hash,
      raw_order = EXCLUDED.raw_order,
      links = EXCLUDED.links,
      synced_at = now()
  `;

  for (const [addressType, address] of [["billing", billing], ["shipping", shipping]] as const) {
    await sql`
      INSERT INTO wc_order_addresses (order_id, address_type, first_name, last_name, company, address_1, address_2, city, state, postcode, country, email, phone, raw_address)
      VALUES (${order.id}, ${addressType}, ${text(address.first_name)}, ${text(address.last_name)}, ${text(address.company)}, ${text(address.address_1)}, ${text(address.address_2)}, ${text(address.city)}, ${text(address.state)}, ${text(address.postcode)}, ${text(address.country)}, ${text(address.email)}, ${text(address.phone)}, ${json(address)})
      ON CONFLICT (order_id, address_type) DO UPDATE SET
        first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, company = EXCLUDED.company,
        address_1 = EXCLUDED.address_1, address_2 = EXCLUDED.address_2, city = EXCLUDED.city,
        state = EXCLUDED.state, postcode = EXCLUDED.postcode, country = EXCLUDED.country,
        email = EXCLUDED.email, phone = EXCLUDED.phone, raw_address = EXCLUDED.raw_address
    `;
  }

  await sql`DELETE FROM wc_order_meta WHERE order_id = ${order.id}`;
  for (const meta of array(order.meta_data)) {
    await sql`
      INSERT INTO wc_order_meta (order_id, meta_id, key, value, raw_meta)
      VALUES (${order.id}, ${int(meta.id)}, ${text(meta.key) ?? ""}, ${metaValue(meta.value)}, ${json(meta)})
    `;
  }

  for (const item of array(order.line_items)) {
    const productId = int(item.product_id);
    const variationId = int(item.variation_id);
    const metaData = array(item.meta_data);
    const productType = variationId > 0 ? "variant" : "simple";
    const productName = text(item.parent_name) ?? text(item.name) ?? `Product ${productId}`;

    await sql`
      INSERT INTO wc_products (product_id, name, sku, product_type, raw_last_line_item)
      VALUES (${productId}, ${productName}, ${text(item.sku)}, ${productType}, ${json(item)})
      ON CONFLICT (product_id) DO UPDATE SET
        name = EXCLUDED.name,
        sku = COALESCE(wc_products.sku, EXCLUDED.sku),
        product_type = CASE WHEN wc_products.product_type = 'variant' OR EXCLUDED.product_type = 'variant' THEN 'variant' ELSE 'simple' END,
        last_seen_at = now(),
        raw_last_line_item = EXCLUDED.raw_last_line_item
    `;

    if (variationId > 0) {
      await sql`
        INSERT INTO wc_product_variants (product_id, variation_id, sku, name, attributes, raw_last_line_item)
        VALUES (${productId}, ${variationId}, ${text(item.sku)}, ${text(item.name)}, ${json(variationAttributes(metaData))}, ${json(item)})
        ON CONFLICT (product_id, variation_id) DO UPDATE SET
          sku = EXCLUDED.sku,
          name = EXCLUDED.name,
          attributes = EXCLUDED.attributes,
          last_seen_at = now(),
          raw_last_line_item = EXCLUDED.raw_last_line_item
      `;
    }

    await sql`
      INSERT INTO wc_order_line_items (order_id, line_item_id, product_id, variation_id, name, sku, quantity, subtotal, subtotal_tax, total, total_tax, tax_class, product_type, raw_taxes, raw_line_item)
      VALUES (${order.id}, ${int(item.id)}, ${productId}, ${variationId > 0 ? variationId : null}, ${text(item.name) ?? ""}, ${text(item.sku)}, ${int(item.quantity)}, ${money(item.subtotal)}, ${money(item.subtotal_tax)}, ${money(item.total)}, ${money(item.total_tax)}, ${text(item.tax_class)}, ${productType}, ${json(item.taxes ?? [])}, ${json(item)})
      ON CONFLICT (order_id, line_item_id) DO UPDATE SET
        product_id = EXCLUDED.product_id, variation_id = EXCLUDED.variation_id, name = EXCLUDED.name,
        sku = EXCLUDED.sku, quantity = EXCLUDED.quantity, subtotal = EXCLUDED.subtotal,
        subtotal_tax = EXCLUDED.subtotal_tax, total = EXCLUDED.total, total_tax = EXCLUDED.total_tax,
        tax_class = EXCLUDED.tax_class, product_type = EXCLUDED.product_type, raw_taxes = EXCLUDED.raw_taxes,
        raw_line_item = EXCLUDED.raw_line_item
    `;

    await sql`DELETE FROM wc_order_line_item_taxes WHERE order_id = ${order.id} AND line_item_id = ${int(item.id)}`;
    for (const tax of array(item.taxes)) {
      await sql`
        INSERT INTO wc_order_line_item_taxes (order_id, line_item_id, tax_rate_id, subtotal, total, raw_tax)
        VALUES (${order.id}, ${int(item.id)}, ${int(tax.id)}, ${money(tax.subtotal)}, ${money(tax.total)}, ${json(tax)})
      `;
    }

    await sql`DELETE FROM wc_order_line_item_meta WHERE order_id = ${order.id} AND line_item_id = ${int(item.id)}`;
    for (const meta of metaData) {
      await sql`
        INSERT INTO wc_order_line_item_meta (order_id, line_item_id, meta_id, key, value, display_key, display_value, raw_meta)
        VALUES (${order.id}, ${int(item.id)}, ${int(meta.id)}, ${text(meta.key) ?? ""}, ${metaValue(meta.value)}, ${text(meta.display_key)}, ${text(meta.display_value)}, ${json(meta)})
      `;
    }
  }

  await sql`DELETE FROM wc_order_taxes WHERE order_id = ${order.id}`;
  for (const tax of array(order.tax_lines)) {
    await sql`
      INSERT INTO wc_order_taxes (order_id, tax_line_id, rate_code, rate_id, label, compound, tax_total, shipping_tax_total, rate_percent, raw_tax_line)
      VALUES (${order.id}, ${int(tax.id)}, ${text(tax.rate_code)}, ${int(tax.rate_id)}, ${text(tax.label)}, ${Boolean(tax.compound)}, ${money(tax.tax_total)}, ${money(tax.shipping_tax_total)}, ${money(tax.rate_percent)}, ${json(tax)})
    `;
  }

  await sql`DELETE FROM wc_order_shipping_lines WHERE order_id = ${order.id}`;
  for (const line of array(order.shipping_lines)) {
    await sql`
      INSERT INTO wc_order_shipping_lines (order_id, shipping_line_id, method_title, method_id, instance_id, total, total_tax, taxes, raw_shipping_line)
      VALUES (${order.id}, ${int(line.id)}, ${text(line.method_title)}, ${text(line.method_id)}, ${text(line.instance_id)}, ${money(line.total)}, ${money(line.total_tax)}, ${json(line.taxes ?? [])}, ${json(line)})
    `;
  }

  await sql`DELETE FROM wc_order_fee_lines WHERE order_id = ${order.id}`;
  for (const line of array(order.fee_lines)) {
    await sql`
      INSERT INTO wc_order_fee_lines (order_id, fee_line_id, name, tax_class, tax_status, total, total_tax, taxes, raw_fee_line)
      VALUES (${order.id}, ${int(line.id)}, ${text(line.name) ?? ""}, ${text(line.tax_class)}, ${text(line.tax_status)}, ${money(line.total)}, ${money(line.total_tax)}, ${json(line.taxes ?? [])}, ${json(line)})
    `;
  }

  await sql`DELETE FROM wc_order_coupon_lines WHERE order_id = ${order.id}`;
  for (const line of array(order.coupon_lines)) {
    await sql`
      INSERT INTO wc_order_coupon_lines (order_id, coupon_line_id, code, discount, discount_tax, raw_coupon_line)
      VALUES (${order.id}, ${int(line.id)}, ${text(line.code) ?? ""}, ${money(line.discount)}, ${money(line.discount_tax)}, ${json(line)})
    `;
  }

  await sql`DELETE FROM wc_order_refunds WHERE order_id = ${order.id}`;
  for (const refund of array(order.refunds)) {
    await sql`
      INSERT INTO wc_order_refunds (order_id, refund_id, reason, total, raw_refund)
      VALUES (${order.id}, ${int(refund.id)}, ${text(refund.reason)}, ${money(refund.total)}, ${json(refund)})
    `;
  }
}

const sql = postgres(process.env.DATABASE_URL ?? "postgresql://localhost:5432/arivie_woocommerce_orders", { max: 1 });
try {
  const orders = await loadOrders(sql);
  await sql.begin(async (tx) => {
    for (const order of orders) await upsertOrder(tx, order);
    await tx`
      UPDATE wc_customers
      SET order_count = counts.order_count,
          first_seen_at = counts.first_seen_at,
          last_seen_at = counts.last_seen_at,
          updated_at = now()
      FROM (
        SELECT customer_id, COUNT(*)::int AS order_count, MIN(date_created) AS first_seen_at, MAX(date_created) AS last_seen_at
        FROM wc_orders
        WHERE customer_id IS NOT NULL
        GROUP BY customer_id
      ) AS counts
      WHERE wc_customers.customer_id = counts.customer_id
    `;
    if (orders.length > 0) {
      const lastSeenDateModified = orders.reduce(
        (latest, order) => new Date(order.date_modified) > new Date(latest) ? order.date_modified : latest,
        orders[0]?.date_modified ?? new Date().toISOString(),
      );
      await tx`
        INSERT INTO wc_sync_state (source, mode, last_successful_sync_at, last_seen_date_modified, last_page, last_order_count)
        VALUES (${source}, ${mode}, now(), ${lastSeenDateModified}, 1, ${orders.length})
        ON CONFLICT (source) DO UPDATE SET
          mode = EXCLUDED.mode,
          last_successful_sync_at = EXCLUDED.last_successful_sync_at,
          last_seen_date_modified = GREATEST(wc_sync_state.last_seen_date_modified, EXCLUDED.last_seen_date_modified),
          last_page = EXCLUDED.last_page,
          last_order_count = EXCLUDED.last_order_count,
          updated_at = now()
      `;
    }
  });
  console.log(`[woocommerce] synced ${orders.length} order(s) from ${source} in ${mode} mode`);
} finally {
  await sql.end();
}
