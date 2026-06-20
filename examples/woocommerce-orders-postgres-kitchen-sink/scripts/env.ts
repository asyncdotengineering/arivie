/* SPDX-License-Identifier: Apache-2.0 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const exampleRoot = resolve(__dirname, "..");
export const repoRoot = resolve(exampleRoot, "../..");

export function loadEnv(): void {
  for (const envPath of [join(repoRoot, ".env"), join(exampleRoot, ".env.local")]) {
    if (!existsSync(envPath)) continue;
    for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const index = trimmed.indexOf("=");
      if (index === -1) continue;
      const key = trimmed.slice(0, index).trim();
      const raw = trimmed.slice(index + 1).trim();
      const value = raw.replace(/^[']|[']$/g, "").replace(/^[\"]|[\"]$/g, "");
      if (process.env[key] == null && value !== "") process.env[key] = value;
    }
  }

  process.env.DATABASE_URL ??= "postgresql://localhost:5432/arivie_woocommerce_orders";
  process.env.ARIVIE_OWNER_ID ??= "woocommerce-demo-store";
  process.env.WOOCOMMERCE_MODE ??= "mock";
}
