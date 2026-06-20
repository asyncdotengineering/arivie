/* SPDX-License-Identifier: Apache-2.0 */
import postgres from "postgres";
import { loadEnv } from "./env.js";

loadEnv();

const sql = postgres(process.env.DATABASE_URL ?? "postgresql://localhost:5432/arivie_woocommerce_orders", { max: 1 });

try {
  const [counts] = await sql<[{ orders: number; line_items: number; products: number; variants: number; customers: number; coupons: number; refunds: number }]>`
    SELECT
      (SELECT COUNT(*)::int FROM wc_orders) AS orders,
      (SELECT COUNT(*)::int FROM wc_order_line_items) AS line_items,
      (SELECT COUNT(*)::int FROM wc_products) AS products,
      (SELECT COUNT(*)::int FROM wc_product_variants) AS variants,
      (SELECT COUNT(*)::int FROM wc_customers) AS customers,
      (SELECT COUNT(*)::int FROM wc_order_coupon_lines) AS coupons,
      (SELECT COUNT(*)::int FROM wc_order_refunds) AS refunds
  `;
  const [revenue] = await sql<[{ simple_revenue: string; variant_revenue: string; refund_total: string }]>`
    SELECT
      COALESCE(SUM(total) FILTER (WHERE product_type = 'simple'), 0)::text AS simple_revenue,
      COALESCE(SUM(total) FILTER (WHERE product_type = 'variant'), 0)::text AS variant_revenue,
      (SELECT COALESCE(SUM(ABS(total)), 0)::text FROM wc_order_refunds) AS refund_total
    FROM wc_order_line_items
  `;
  const [repeatCustomers] = await sql<[{ repeat_customers: number }]>`
    SELECT COUNT(*)::int AS repeat_customers FROM wc_customers WHERE order_count > 1
  `;

  console.log(`[woocommerce] counts ${JSON.stringify(counts)}`);
  console.log(`[woocommerce] revenue ${JSON.stringify(revenue)}`);

  if (counts.orders !== 5) throw new Error(`expected 5 orders, got ${counts.orders}`);
  if (counts.line_items !== 7) throw new Error(`expected 7 line items, got ${counts.line_items}`);
  if (counts.variants < 4) throw new Error(`expected at least 4 variants, got ${counts.variants}`);
  if (counts.coupons !== 3) throw new Error(`expected 3 coupon lines, got ${counts.coupons}`);
  if (counts.refunds !== 1) throw new Error(`expected 1 refund, got ${counts.refunds}`);
  if (repeatCustomers.repeat_customers !== 1) throw new Error(`expected 1 repeat customer, got ${repeatCustomers.repeat_customers}`);
  console.log("[woocommerce] normalization validation passed");
} finally {
  await sql.end();
}
