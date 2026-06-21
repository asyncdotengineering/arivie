/* SPDX-License-Identifier: Apache-2.0 */
import { loadEnv } from "./env.js";
import { runAnalystPrompt } from "./session-chat.js";

loadEnv();

const { arivie } = await import("../arivie.config.js");

const user = {
  userId: "woocommerce-analyst",
  permissions: ["analytics:read", "finance:read"],
  dbRole: "arivie_reader",
};

const prompts = [
  "Show net sales by week for the last 90 days. State whether shipping, taxes, and refunds are included.",
  "Which product variants drove the most revenue? Include SKU, product_id, variation_id, revenue, and units sold.",
  "Compare simple products vs variant products by revenue and units sold.",
  "Which coupons had the biggest impact on revenue?",
  "Which customers are repeat purchasers?",
  "Write a concise Markdown sales report for the last 30 days.",
];

try {
  for (const prompt of prompts) {
    const text = await runAnalystPrompt(arivie, {
      prompt,
      user,
      conversationId: "woocommerce:demo",
      resourceId: "woocommerce-demo-store",
    });
    console.log(`\n## ${prompt}\n`);
    console.log(text.trim());
  }
} finally {
  await arivie.dispose();
}
