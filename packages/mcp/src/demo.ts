/* SPDX-License-Identifier: Apache-2.0 */
import type { SemanticLayer } from "@arivie/semantic";

/**
 * A tiny built-in semantic layer used when {@link makeMcpServer} is started with
 * no `semantic` option (zero-config / `npx @arivie/mcp` discovery + validation).
 * It makes the `schema` tool and the `arivie://semantic/*` resources return real,
 * explorable content without any configuration. Replace it by passing your own
 * `semantic` layer to `makeMcpServer`.
 */
export const SAMPLE_SEMANTIC: SemanticLayer = {
  catalog: {
    generated_at: "1970-01-01T00:00:00.000Z",
    source_files: ["(built-in sample)"],
    entities: [
      {
        name: "orders",
        description: "Sample e-commerce orders — one row per order.",
        keywords: ["revenue", "orders", "sales", "refunds"],
      },
      {
        name: "customers",
        description: "Sample customers — one row per customer.",
        keywords: ["customer", "email", "signup"],
      },
    ],
    glossary: [
      {
        term: "net revenue",
        status: "defined",
        definition: "SUM(total - tax - shipping) for non-cancelled orders.",
      },
    ],
  },
  entities: new Map([
    [
      "orders",
      {
        name: "orders",
        description: "Sample e-commerce orders — one row per order.",
        grain: "one row per order",
        primary_key: "id",
        measures: [
          {
            name: "net_revenue",
            description: "Net revenue (total minus tax and shipping).",
            sql: "SUM(total - tax - shipping)",
          },
          { name: "order_count", description: "Number of orders.", sql: "COUNT(*)" },
        ],
        dimensions: [
          { name: "status", description: "Order status.", sql: "status" },
          { name: "created_at", description: "Order creation timestamp.", sql: "created_at" },
        ],
      },
    ],
    [
      "customers",
      {
        name: "customers",
        description: "Sample customers — one row per customer.",
        grain: "one row per customer",
        primary_key: "id",
        measures: [
          { name: "customer_count", description: "Number of customers.", sql: "COUNT(*)" },
        ],
        dimensions: [{ name: "email", description: "Customer email.", sql: "email" }],
      },
    ],
  ]) as SemanticLayer["entities"],
} as SemanticLayer;
