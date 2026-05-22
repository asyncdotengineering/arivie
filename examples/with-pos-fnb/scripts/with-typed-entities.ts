/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Demonstrates the TypeScript-first semantic-layer authoring
 * path (defineEntity + composeSemantic) works end-to-end against a live
 * model. Equivalent to authoring `semantic/entities/tickets.yml` +
 * `outlets.yml`, but everything declared inline in TS and fed to
 * defineArivie via `semantic.layer`.
 *
 *   pnpm -C arivie exec tsx examples/with-pos-fnb/scripts/with-typed-entities.ts
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import {
  composeSemantic,
  defineArivie,
  defineEntity,
  localWorkspace,
} from "@arivie/core";
import { postgresAdapter } from "@arivie/db-postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "..", ".env.local");
const workspaceRoot = resolve(__dirname, "..", "workspace");

function loadEnv(): void {
  try {
    const raw = readFileSync(envPath, "utf8");
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq < 0) continue;
      const k = t.slice(0, eq).trim();
      const v = t.slice(eq + 1).trim();
      if (process.env[k] == null && v) process.env[k] = v;
    }
  } catch {
    // best effort
  }
}

async function main(): Promise<void> {
  loadEnv();

  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  const databaseUrl = process.env.DATABASE_URL;
  if (!apiKey) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY required");
  if (!databaseUrl) throw new Error("DATABASE_URL required");

  // ── Author entities in TS — no YAML files involved. ─────────────────
  const outlets = defineEntity({
    name: "outlets",
    description: "F&B outlets (restaurants/bars) the chain operates.",
    grain: "one row per outlet",
    primary_key: "id",
    dimensions: [
      { name: "id", sql: "id", type: "text" },
      { name: "name", sql: "name", type: "text" },
      { name: "city", sql: "city", type: "text" },
      { name: "concept", sql: "concept", type: "text" },
    ],
  });

  const tickets = defineEntity({
    name: "tickets",
    description: "POS tickets (orders). One row per ticket.",
    grain: "one row per ticket",
    primary_key: "id",
    measures: [
      {
        name: "revenue",
        description: "Net revenue (subtotal minus discounts/comps/voids, excluding voided tickets)",
        sql: "SUM(subtotal - discount_amount - comp_amount - void_amount) FILTER (WHERE status NOT IN ('voided'))",
      },
      {
        name: "ticket_count",
        description: "Count of non-voided tickets",
        sql: "COUNT(*) FILTER (WHERE status NOT IN ('voided'))",
      },
    ],
    dimensions: [
      { name: "id", sql: "id", type: "text" },
      { name: "outlet_id", sql: "outlet_id", type: "text" },
      { name: "business_day", sql: "business_day", type: "date" },
      { name: "status", sql: "status", values: ["open", "closed", "voided", "paid"] },
    ],
    segments: [
      {
        name: "yesterday",
        sql: "business_day = (CURRENT_DATE - INTERVAL '1 day')::date",
      },
      {
        name: "last_7_days",
        sql: "business_day >= (CURRENT_DATE - INTERVAL '7 days')::date",
      },
    ],
    joins: [
      { to: "outlets", on: "tickets.outlet_id = outlets.id", type: "many_to_one" },
    ],
  });

  // ── Compose into a SemanticLayer (NO yaml loader, NO filesystem). ───
  const layer = composeSemantic({ entities: [outlets, tickets] });

  console.log(`composed semantic: ${layer.entities.size} entities`);
  console.log(`  catalog: ${layer.catalog.entities.map((e) => e.name).join(", ")}`);

  // ── Wire defineArivie with semantic.layer (not semantic.path). ──────
  const google = createGoogleGenerativeAI({ apiKey });
  const model = google("gemini-2.5-flash");

  const instance = await defineArivie({
    owner: { id: "lumiere-chain", name: "Lumière Chain" },
    model,
    semantic: { layer, mode: "preload", path: "" },
    sources: {
      postgres: {
        adapter: postgresAdapter({
          url: databaseUrl,
          readOnlyRole: "arivie_reader",
        }),
        description:
          "Lumière F&B operational Postgres — used by the typed-entities smoke.",
        useWhen: "any orders/customers/products question in the typed-entities demo",
      },
    },
    workspace: localWorkspace({ at: workspaceRoot, bash: false }),
    compileMetric: true,
    resolveUser: async () => ({
      userId: "probe",
      permissions: ["analytics:read"],
      dbRole: "arivie_reader",
    }),
  });

  console.log("\n→ model: gemini-2.5-flash");
  console.log("→ semantic: TS-authored via defineEntity + composeSemantic");
  console.log("→ entities: outlets, tickets");
  console.log("");

  const result = await instance.ask({
    prompt:
      "How many tickets did we have yesterday, broken down by outlet_id? Use the tickets entity's ticket_count measure with the yesterday segment, joined to outlets.",
    user: {
      userId: "probe",
      permissions: ["analytics:read"],
      dbRole: "arivie_reader",
    },
  });

  console.log("── tool calls ──");
  for (const [i, c] of result.toolCalls.entries()) {
    const argSnip = JSON.stringify(c.args).slice(0, 300);
    console.log(`  [${i}] ${c.tool}  ${argSnip}`);
  }

  console.log("\n── answer ──");
  console.log(result.text);

  if (result.sql.length > 0) {
    console.log("\n── sql ──");
    for (const s of result.sql) console.log(`  ${s.slice(0, 300).replace(/\s+/g, " ")}`);
  }

  await instance.dispose();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
