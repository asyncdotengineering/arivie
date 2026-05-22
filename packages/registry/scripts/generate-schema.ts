/* SPDX-License-Identifier: Apache-2.0 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";
import { RegistryItemSchema } from "./registry-schema.js";

const outPath = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  "registry.schema.json",
);

const schema = zodToJsonSchema(RegistryItemSchema, {
  name: "RegistryItem",
  $refStrategy: "none",
});

writeFileSync(outPath, `${JSON.stringify(schema, null, 2)}\n`, "utf8");
console.log(`Wrote ${outPath}`);
