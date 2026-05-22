/* SPDX-License-Identifier: Apache-2.0 */
import type postgres from "postgres";
import type { TableMetadata } from "./types.js";

const PII_RE =
  /email|phone|ssn|address|dob|password|secret|token|card/i;

interface TableRow {
  table_name: string;
}

interface ColumnRow {
  column_name: string;
  data_type: string;
  is_nullable: string;
  comment: string | null;
}

interface PkRow {
  column_name: string;
}

interface FkRow {
  column_name: string;
  references_table: string;
  references_column: string;
}

interface RowCountRow {
  row_count: string | number | null;
}

export async function introspect(sql: postgres.Sql): Promise<TableMetadata[]> {
  const tables = await sql<TableRow[]>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `;

  const result: TableMetadata[] = [];

  for (const { table_name } of tables) {
    const columns = await sql<ColumnRow[]>`
      SELECT
        c.column_name,
        c.data_type,
        c.is_nullable,
        pgd.description AS comment
      FROM information_schema.columns c
      LEFT JOIN pg_catalog.pg_statio_all_tables st
        ON st.schemaname = c.table_schema
        AND st.relname = c.table_name
      LEFT JOIN pg_catalog.pg_description pgd
        ON pgd.objoid = st.relid
        AND pgd.objsubid = c.ordinal_position
      WHERE c.table_schema = 'public'
        AND c.table_name = ${table_name}
      ORDER BY c.ordinal_position
    `;

    const pkRows = await sql<PkRow[]>`
      SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
        AND tc.table_name = kcu.table_name
      WHERE tc.table_schema = 'public'
        AND tc.table_name = ${table_name}
        AND tc.constraint_type = 'PRIMARY KEY'
      ORDER BY kcu.ordinal_position
    `;

    const fkRows = await sql<FkRow[]>`
      SELECT
        kcu.column_name,
        ccu.table_name AS references_table,
        ccu.column_name AS references_column
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
        AND tc.table_name = kcu.table_name
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.table_schema = 'public'
        AND tc.table_name = ${table_name}
        AND tc.constraint_type = 'FOREIGN KEY'
      ORDER BY kcu.ordinal_position
    `;

    const countRows = await sql<RowCountRow[]>`
      SELECT reltuples::bigint AS row_count
      FROM pg_class
      WHERE relname = ${table_name}
    `;

    const rowCountRaw = countRows[0]?.row_count;
    const row_count =
      rowCountRaw === null || rowCountRaw === undefined
        ? 0
        : Number(rowCountRaw);

    result.push({
      schema: "public",
      name: table_name,
      columns: columns.map((col) => {
        const column: TableMetadata["columns"][number] = {
          name: col.column_name,
          type: col.data_type,
          nullable: col.is_nullable === "YES",
        };
        if (col.comment) {
          column.comment = col.comment;
        }
        if (PII_RE.test(col.column_name)) {
          column.isPii = true;
        }
        return column;
      }),
      primary_key: pkRows.map((r) => r.column_name),
      foreign_keys: fkRows.map((r) => ({
        column: r.column_name,
        references: {
          table: r.references_table,
          column: r.references_column,
        },
      })),
      row_count,
    });
  }

  // [S0-fix r2-n1] Removed unused pg_indexes query — the result is not surfaced in TableMetadata.
  // If `indexes` is added to the TableMetadata interface in a future RFC amendment, reintroduce here.

  return result;
}
