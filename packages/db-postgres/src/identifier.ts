/* SPDX-License-Identifier: Apache-2.0 */
import { ToolError } from "./errors.js";

const IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export function escapeIdent(name: string): string {
  if (!IDENT_RE.test(name)) {
    throw new ToolError("sql-invalid", `invalid identifier: ${name}`);
  }
  return `"${name}"`;
}
