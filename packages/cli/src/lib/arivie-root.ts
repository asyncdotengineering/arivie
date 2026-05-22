/* SPDX-License-Identifier: Apache-2.0 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Monorepo `arivie/` root (`src/lib` → `cli` → `packages` → `arivie`). */
export const ARIVIE_MONOREPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);
