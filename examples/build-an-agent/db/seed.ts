/* SPDX-License-Identifier: Apache-2.0 */
// Seeds a tiny, deterministic storefront: 5 customers, ~40 orders over the
// last 30 days. Re-runnable (truncates first).
import postgres from "postgres";

const url = process.env.DATABASE_URL ?? "postgresql://localhost:5432/arivie_tutorial";
const sql = postgres(url, { onnotice: () => {} });

const customers = [
  { name: "Acme", plan: "enterprise" },
  { name: "Globex", plan: "pro" },
  { name: "Initech", plan: "free" },
  { name: "Hooli", plan: "pro" },
  { name: "Umbrella", plan: "enterprise" },
];

// Deterministic pseudo-random so the tutorial's numbers are stable.
let seed = 42;
const rand = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

try {
  await sql`TRUNCATE orders, customers RESTART IDENTITY CASCADE`;
  const inserted = await sql`
    INSERT INTO customers ${sql(customers, "name", "plan")} RETURNING id
  `;
  const ids = inserted.map((r) => r.id as number);

  const orders: { customer_id: number; status: string; amount_cents: number; created_at: Date }[] = [];
  for (let day = 29; day >= 0; day--) {
    const count = 1 + Math.floor(rand() * 2); // 1–2 orders/day
    for (let i = 0; i < count; i++) {
      const customer_id = ids[Math.floor(rand() * ids.length)]!;
      const amount_cents = 1500 + Math.floor(rand() * 20000); // $15–$215
      const roll = rand();
      const status = roll < 0.08 ? "refunded" : roll < 0.12 ? "pending" : "paid";
      const created_at = new Date(Date.now() - day * 86400000 - Math.floor(rand() * 80000000));
      orders.push({ customer_id, status, amount_cents, created_at });
    }
  }
  await sql`INSERT INTO orders ${sql(orders, "customer_id", "status", "amount_cents", "created_at")}`;
  console.log(`[seed] ${ids.length} customers, ${orders.length} orders`);
} finally {
  await sql.end();
}
