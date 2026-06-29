/* SPDX-License-Identifier: Apache-2.0 */
/** Eval database adapters backed by in-process PGlite. */
import type { PostgresAdapter } from "@arivie/db-postgres";
import { pglitePostgresAdapter } from "./pglite-adapter.js";

export interface EvalAdapters {
  db: PostgresAdapter;
  readerDb: PostgresAdapter;
  cleanup: () => Promise<void>;
}

export async function createEvalAdapters(): Promise<EvalAdapters> {
  const db = await pglitePostgresAdapter();

  return {
    db,
    readerDb: db,
    cleanup: async () => {
      await db.close?.();
    },
  };
}
