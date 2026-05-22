/* SPDX-License-Identifier: Apache-2.0 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ArivieConfig } from "@arivie/core/types";
import { parseEntity } from "@arivie/semantic";
import { defineCommand } from "citty";
import { tableMetadataToEntityYaml } from "../lib/introspect-to-yaml.js";
import { loadArivieConfig } from "../lib/load-config.js";
import { postgresAdapterFromConfig } from "../lib/postgres-from-config.js";
import { validateTableName } from "../lib/path-safety.js";

export const addEntityCommand = defineCommand({
  meta: {
    name: "entity",
    description: "Introspect a Postgres table and emit semantic/entities/<table>.yml",
  },
  args: {
    config: {
      type: "string",
      description: "Path to arivie.config.ts",
      default: "./arivie.config.ts",
    },
    table: {
      type: "positional",
      description: "Table name (public schema)",
      required: true,
    },
  },
  async run({ args }) {
    const tableName = args.table;
    if (tableName == null || tableName.length === 0) {
      console.error("add entity: missing table name");
      return 1;
    }

    return runAddEntity(tableName, args.config);
  },
});

/** @internal Exported for integration tests. */
export async function runAddEntity(
  tableName: string,
  configOrPath: ArivieConfig | string = "./arivie.config.ts",
): Promise<number> {
    const tableError = validateTableName(tableName);
    if (tableError != null) {
      console.error(`add entity: ${tableError}`);
      return 1;
    }

    const config =
      typeof configOrPath === "string"
        ? await loadArivieConfig(configOrPath)
        : configOrPath;
    const tables = await postgresAdapterFromConfig(config).introspect();
    const table = tables.find((t) => t.name === tableName);

    if (table == null) {
      console.error(`add entity: table not found in public schema: ${tableName}`);
      return 1;
    }

    const columnPreview = table.columns
      .slice(0, 6)
      .map((c) => c.name)
      .join(", ");
    const suffix =
      table.columns.length > 6 ? ", ..." : "";
    console.log(
      `✓ Introspected public.${tableName} (${columnPreview}${suffix})`,
    );

    const yaml = tableMetadataToEntityYaml(table);
    const entitiesDir = join(config.semantic.path, "entities");
    const outPath = join(entitiesDir, `${tableName}.yml`);
    await mkdir(entitiesDir, { recursive: true });
    await writeFile(outPath, yaml, "utf8");

    const parsed = parseEntity(outPath, yaml);
    if (!parsed.ok) {
      console.error(`add entity: generated YAML failed validation: ${parsed.error.message}`);
      return 1;
    }

    const rel = join(config.semantic.path, "entities", `${tableName}.yml`);
    console.log(`✓ Wrote ${rel} (parses via EntitySchema)`);
    return 0;
}
