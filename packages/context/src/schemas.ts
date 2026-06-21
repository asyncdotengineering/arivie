/* SPDX-License-Identifier: Apache-2.0 */
import type { StandardSchemaV1 } from "@standard-schema/spec";

/**
 * Declares one kind of context document the layer knows how to load and
 * validate. Two first-class representations (RFC REQ-4):
 *
 *  - `knowledge` — prose Markdown pages with frontmatter. No `schema`; the
 *    body is the payload.
 *  - `executable` — structured specs (e.g. YAML) validated by `schema`. The
 *    analytics semantic layer is one executable schema (RFC REQ-5).
 *
 * Schemas are declared statically by plugins and merged into the runtime
 * manifest, so `arivie info` can list them without running plugin setup
 * (RFC §12 Q4). The full loader/validator is built in C3.
 */
export interface ContextSchemaDefinition {
  /** Unique schema id within the app (collision-checked at manifest build). */
  id: string;
  /** Representation kind. */
  kind: "knowledge" | "executable";
  /** One-line description surfaced in diagnostics and `arivie info`. */
  description?: string;
  /**
   * Standard Schema validating an executable document's parsed `data`.
   * Required for `executable`; omitted for `knowledge`.
   */
  schema?: StandardSchemaV1<unknown>;
}
