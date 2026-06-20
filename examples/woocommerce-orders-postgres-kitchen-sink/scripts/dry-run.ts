/* SPDX-License-Identifier: Apache-2.0 */
import postgres from "postgres";
import { loadEnv } from "./env.js";

loadEnv();

const sql = postgres(process.env.DATABASE_URL ?? "postgresql://localhost:5432/arivie_woocommerce_orders", { max: 1 });

try {
  const rows = await sql`
    SELECT status, COUNT(*)::int AS orders, SUM(total)::numeric(18,2)::text AS order_total
    FROM wc_orders
    GROUP BY status
    ORDER BY status
  `;
  const variants = await sql`
    SELECT product_type, SUM(quantity)::int AS units, SUM(total)::numeric(18,2)::text AS line_revenue
    FROM wc_order_line_items
    GROUP BY product_type
    ORDER BY product_type
  `;
  console.log("[woocommerce] order status summary");
  console.table(rows);
  console.log("[woocommerce] simple vs variant line-item summary");
  console.table(variants);
} finally {
  await sql.end();
}
