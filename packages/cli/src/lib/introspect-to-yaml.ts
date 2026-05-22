/* SPDX-License-Identifier: Apache-2.0 */
import { stringify } from "yaml";
import type { TableMetadata } from "@arivie/db-postgres";
import { EntitySchema } from "@arivie/semantic";

function primaryKeyString(primaryKey: string[]): string {
  if (primaryKey.length === 0) {
    return "id";
  }
  return primaryKey.join(", ");
}

/** Map Postgres introspection metadata to an EntitySchema-compliant YAML scaffold. */
export function tableMetadataToEntityYaml(table: TableMetadata): string {
  const entity = {
    name: table.name,
    description: "",
    grain: `one row per ${table.name.replace(/_/g, " ").replace(/s$/, "")}`,
    primary_key: primaryKeyString(table.primary_key),
    schema: table.schema,
    columns: table.columns.map((col) => ({
      name: col.name,
      type: col.type,
      description: col.comment ?? "",
      ...(col.isPii === true ? { pii: true } : {}),
    })),
  };

  const parsed = EntitySchema.parse(entity);
  return stringify(parsed, { lineWidth: 0 });
}
