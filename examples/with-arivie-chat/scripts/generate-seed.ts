/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Generate seed/002_seed.sql with deterministic synthetic e-commerce data.
 * Run with: pnpm exec tsx scripts/generate-seed.ts
 *
 * Run once at repo time. Output is checked in so users don't need to run it.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

// Deterministic PRNG (Mulberry32) — same numbers every run.
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(42);
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];
const randInt = (lo: number, hi: number) =>
  lo + Math.floor(rand() * (hi - lo + 1));

const FIRST_NAMES = [
  "Ava",
  "Liam",
  "Noah",
  "Mia",
  "Zoe",
  "Ethan",
  "Iris",
  "Kai",
  "Jade",
  "Leo",
  "Maya",
  "Sage",
  "Finn",
  "Luna",
  "Owen",
  "Ruby",
  "Theo",
  "Eden",
  "Nora",
  "Reid",
  "Hugo",
  "Cleo",
  "Asha",
  "Niko",
  "Vera",
  "Otis",
  "Hana",
  "Quinn",
  "Sana",
  "Yuki",
];
const LAST_NAMES = [
  "Kim",
  "Patel",
  "Müller",
  "Costa",
  "Walsh",
  "Sato",
  "Reyes",
  "Nguyen",
  "Cohen",
  "Wright",
  "Abara",
  "Yates",
  "Holt",
  "Mensah",
  "Ito",
  "Park",
  "Singh",
  "Ng",
  "Diaz",
  "Khan",
  "Roy",
  "Lin",
  "Bauer",
  "Adams",
  "Yoon",
  "Tran",
  "Beck",
  "Akel",
];
const COUNTRIES = ["US", "GB", "CA", "AU", "DE"];
const COUNTRY_WEIGHTS = [0.45, 0.18, 0.12, 0.1, 0.15];

const PRODUCTS: { name: string; category: string; price: number }[] = [
  { name: "Bamboo throw blanket", category: "home", price: 64.0 },
  { name: "Linen apron", category: "home", price: 38.0 },
  { name: "Ceramic pour-over", category: "home", price: 52.0 },
  { name: 'Cast iron skillet 10"', category: "home", price: 89.0 },
  { name: "Walnut cutting board", category: "home", price: 72.0 },
  { name: "Merino crewneck", category: "apparel", price: 145.0 },
  { name: "Selvedge denim", category: "apparel", price: 198.0 },
  { name: "Linen camp shirt", category: "apparel", price: 88.0 },
  { name: "Waxed canvas jacket", category: "apparel", price: 285.0 },
  { name: "Wool watchcap", category: "apparel", price: 42.0 },
  { name: "USB-C hub", category: "electronics", price: 79.0 },
  { name: "Mech keyboard", category: "electronics", price: 165.0 },
  { name: "Wireless earbuds", category: "electronics", price: 129.0 },
  { name: "Desk lamp (warm)", category: "electronics", price: 95.0 },
  { name: "Portable speaker", category: "electronics", price: 119.0 },
  { name: "The Pragmatic Programmer", category: "books", price: 36.0 },
  { name: "Designing Data-Intensive Apps", category: "books", price: 49.0 },
  { name: "A Pattern Language", category: "books", price: 58.0 },
  { name: "Where Good Ideas Come From", category: "books", price: 22.0 },
  { name: "Calm Technology", category: "books", price: 28.0 },
];

function pickCountry(): string {
  const r = rand();
  let acc = 0;
  for (let i = 0; i < COUNTRIES.length; i++) {
    acc += COUNTRY_WEIGHTS[i];
    if (r < acc) return COUNTRIES[i];
  }
  return COUNTRIES[COUNTRIES.length - 1];
}

// Anchor date — set absolute so the seed is reproducible. The starter
// targets "the last N days" questions so we anchor 90 days back from
// a fixed point in time; users re-seeding can edit this if they want
// "today"-relative data.
const NOW = new Date("2026-05-22T00:00:00Z").getTime();
const DAY = 24 * 60 * 60 * 1000;

function isoBetween(daysAgoLo: number, daysAgoHi: number): string {
  const ms = NOW - randInt(daysAgoLo, daysAgoHi) * DAY - randInt(0, DAY - 1);
  return new Date(ms).toISOString();
}

// 30 customers — joined across the past 6 months
const customers = Array.from({ length: 30 }, (_, i) => {
  const first = pick(FIRST_NAMES);
  const last = pick(LAST_NAMES);
  return {
    id: `cust_${String(i + 1).padStart(3, "0")}`,
    email: `${first.toLowerCase()}.${last.toLowerCase()}@example.com`,
    name: `${first} ${last}`,
    country: pickCountry(),
    created_at: isoBetween(7, 180),
  };
});

// 20 products
const products = PRODUCTS.map((p, i) => ({
  id: `prod_${String(i + 1).padStart(3, "0")}`,
  ...p,
  created_at: isoBetween(120, 365),
}));

// 80 orders — spread across the past 90 days, status mostly completed
const STATUSES = [
  "completed",
  "completed",
  "completed",
  "completed",
  "pending",
  "cancelled",
  "refunded",
];
const orders = Array.from({ length: 80 }, (_, i) => {
  const customer = pick(customers);
  return {
    id: `ord_${String(i + 1).padStart(4, "0")}`,
    customer_id: customer.id,
    status: pick(STATUSES),
    created_at: isoBetween(0, 90),
  };
});

// 1–4 items per order
type Item = {
  id: string;
  order_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
};
const items: Item[] = [];
let itemCounter = 0;
for (const order of orders) {
  const lineCount = randInt(1, 4);
  const seen = new Set<string>();
  for (let l = 0; l < lineCount; l++) {
    let product = pick(products);
    let guard = 0;
    while (seen.has(product.id) && guard < 8) {
      product = pick(products);
      guard++;
    }
    seen.add(product.id);
    const quantity = randInt(1, 3);
    const unit_price = product.price;
    const subtotal = Math.round(unit_price * quantity * 100) / 100;
    items.push({
      id: `oi_${String(++itemCounter).padStart(5, "0")}`,
      order_id: order.id,
      product_id: product.id,
      quantity,
      unit_price,
      subtotal,
    });
  }
}

// Compute orders.total_amount from items
const orderTotals = new Map<string, number>();
for (const it of items) {
  orderTotals.set(
    it.order_id,
    (orderTotals.get(it.order_id) ?? 0) + it.subtotal,
  );
}

const esc = (s: string) => s.replace(/'/g, "''");

const lines: string[] = [
  "-- SPDX-License-Identifier: Apache-2.0",
  "-- Auto-generated by scripts/generate-seed.ts — do not edit by hand.",
  "-- Deterministic synthetic e-commerce data for the Arivie chat starter.",
  "",
  "BEGIN;",
  "",
  "TRUNCATE order_items, orders, products, customers RESTART IDENTITY CASCADE;",
  "",
];

lines.push("-- customers");
for (const c of customers) {
  lines.push(
    `INSERT INTO customers (id, email, name, country, created_at) VALUES ('${c.id}', '${esc(c.email)}', '${esc(c.name)}', '${c.country}', '${c.created_at}');`,
  );
}
lines.push("", "-- products");
for (const p of products) {
  lines.push(
    `INSERT INTO products (id, name, category, price, created_at) VALUES ('${p.id}', '${esc(p.name)}', '${p.category}', ${p.price.toFixed(2)}, '${p.created_at}');`,
  );
}
lines.push("", "-- orders");
for (const o of orders) {
  const total = (orderTotals.get(o.id) ?? 0).toFixed(2);
  lines.push(
    `INSERT INTO orders (id, customer_id, status, total_amount, created_at) VALUES ('${o.id}', '${o.customer_id}', '${o.status}', ${total}, '${o.created_at}');`,
  );
}
lines.push("", "-- order_items");
for (const it of items) {
  lines.push(
    `INSERT INTO order_items (id, order_id, product_id, quantity, unit_price, subtotal) VALUES ('${it.id}', '${it.order_id}', '${it.product_id}', ${it.quantity}, ${it.unit_price.toFixed(2)}, ${it.subtotal.toFixed(2)});`,
  );
}

lines.push("", "COMMIT;", "");

const outPath = join(import.meta.dirname, "..", "seed", "002_seed.sql");
writeFileSync(outPath, lines.join("\n"));
console.log(
  `wrote ${outPath}: ${customers.length} customers, ${products.length} products, ${orders.length} orders, ${items.length} items`,
);
