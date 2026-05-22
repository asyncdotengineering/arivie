/* SPDX-License-Identifier: Apache-2.0 */
import { ToolError } from "./errors.js";

/**
 * Lightweight SQL validator used by `@arivie/agent`'s `execute` tool.
 *
 * Sprint 1 KI-1-05 (pi r2 M-r2-1): the previous prefix-only check `/^(SELECT|WITH)\b/i`
 * accepted bypasses like `WITH x AS (DELETE FROM …) SELECT *` (CTE-DML) and
 * `SELECT 1; DROP TABLE foo` (multi-statement via `tx.unsafe`). The database
 * role rejects writes at execution time — defence-in-depth still holds — but
 * the framework guard needs to reject the obvious bypasses up front.
 *
 * This implementation is a state-machine token scanner that:
 *   - strips line comments (`-- ... \n`) and block comments (`/* ... *\/`),
 *   - tracks single-quote / double-quote / dollar-quote string literal state,
 *   - rejects `;` outside literals (multi-statement bypass),
 *   - rejects DML/DDL keywords outside literals (CTE-DML bypass),
 *   - requires the FIRST keyword (after comments + whitespace) to be SELECT or WITH.
 *
 * For Sprint 2: replace with a real Postgres parser if the false-positive rate
 * on string-literal keyword matches becomes a problem. RFC-002 §6.4 to be
 * amended to require AST validation.
 */

/** Keywords whose presence (outside string literals/comments) indicates a non-read statement. */
const FORBIDDEN_KEYWORDS = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "MERGE",
  "TRUNCATE",
  "DROP",
  "CREATE",
  "ALTER",
  "GRANT",
  "REVOKE",
  "REINDEX",
  "VACUUM",
  "CLUSTER",
  "COPY",
  "CALL",
  "DO",
  "LOCK",
  "COMMENT",
  "REFRESH",
  "REASSIGN",
  "EXECUTE",
  "PREPARE",
  "DEALLOCATE",
  "DISCARD",
  "LISTEN",
  "NOTIFY",
  "UNLISTEN",
  "SET",
  "RESET",
] as const;

const SYSTEM_CATALOG_PATTERN = /\b(pg_catalog|information_schema)\b/i;

const FORBIDDEN_PATTERN = new RegExp(
  `\\b(${FORBIDDEN_KEYWORDS.join("|")})\\b`,
  "i",
);

/**
 * Strip comments + string literals from a SQL string, leaving structural tokens
 * for downstream keyword scanning. Returns the stripped string with literals
 * replaced by single-character placeholders so character positions are preserved.
 */
function stripLiteralsAndComments(sql: string): string {
  const out: string[] = [];
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    if (c === undefined) {
      break;
    }
    const next = i + 1 < n ? sql[i + 1] : "";

    // Line comment: -- ... to end of line
    if (c === "-" && next === "-") {
      while (i < n && sql[i] !== "\n") {
        out.push(" ");
        i += 1;
      }
      continue;
    }

    // Block comment: /* ... */
    if (c === "/" && next === "*") {
      out.push("  ");
      i += 2;
      while (i < n) {
        if (sql[i] === "*" && i + 1 < n && sql[i + 1] === "/") {
          out.push("  ");
          i += 2;
          break;
        }
        out.push(" ");
        i += 1;
      }
      continue;
    }

    // Single-quoted string: '...' with '' as escape
    if (c === "'") {
      out.push("'");
      i += 1;
      while (i < n) {
        if (sql[i] === "'") {
          // Escaped quote ''
          if (i + 1 < n && sql[i + 1] === "'") {
            out.push("  ");
            i += 2;
            continue;
          }
          out.push("'");
          i += 1;
          break;
        }
        out.push(" ");
        i += 1;
      }
      continue;
    }

    // Double-quoted identifier: "..." with "" as escape (treated as a literal for our purposes)
    if (c === '"') {
      out.push('"');
      i += 1;
      while (i < n) {
        if (sql[i] === '"') {
          if (i + 1 < n && sql[i + 1] === '"') {
            out.push("  ");
            i += 2;
            continue;
          }
          out.push('"');
          i += 1;
          break;
        }
        out.push(" ");
        i += 1;
      }
      continue;
    }

    // Dollar-quoted string: $tag$ ... $tag$
    if (c === "$") {
      const tagMatch = /^\$([A-Za-z_][A-Za-z_0-9]*)?\$/.exec(sql.slice(i));
      if (tagMatch != null) {
        const tag = tagMatch[0];
        out.push(" ".repeat(tag.length));
        i += tag.length;
        const end = sql.indexOf(tag, i);
        if (end === -1) {
          // Unterminated; consume the rest and bail (will be caught downstream).
          while (i < n) {
            out.push(" ");
            i += 1;
          }
          continue;
        }
        while (i < end) {
          out.push(" ");
          i += 1;
        }
        out.push(" ".repeat(tag.length));
        i += tag.length;
        continue;
      }
    }

    out.push(c);
    i += 1;
  }
  return out.join("");
}

/** First identifier-ish token in a SQL string (after comments + whitespace). */
function firstKeyword(sql: string): string | null {
  const stripped = stripLiteralsAndComments(sql);
  const m = /\s*\(*\s*([A-Za-z_][A-Za-z_0-9]*)/.exec(stripped);
  return m?.[1] ? m[1].toUpperCase() : null;
}

/**
 * Validate a SQL query for the agent's `execute` tool.
 *
 * Throws `ToolError` on rejection; returns void on accept.
 *
 * Rejection conditions (Sprint 1 KI-1-05):
 *   - First keyword is not SELECT or WITH.
 *   - Query contains `;` outside literals/comments (multi-statement).
 *   - Query contains any DML/DDL/session-mutation keyword outside literals/comments.
 *   - Query references `pg_catalog` / `information_schema` (system catalog block).
 */
export function validateExecuteSql(sql: string): void {
  const trimmed = sql.trim();
  if (trimmed.length === 0) {
    throw new ToolError("sql-invalid", "empty query");
  }

  const stripped = stripLiteralsAndComments(trimmed);

  // Multi-statement check
  if (stripped.includes(";")) {
    // Allow a single trailing semicolon (after final non-whitespace) — common shell habit.
    const lastSemi = stripped.lastIndexOf(";");
    const tail = stripped.slice(lastSemi + 1).trim();
    if (tail.length > 0) {
      throw new ToolError(
        "sql-invalid",
        "multi-statement queries are not allowed",
      );
    }
  }

  // First keyword must be SELECT or WITH
  const head = firstKeyword(trimmed);
  if (head !== "SELECT" && head !== "WITH") {
    throw new ToolError(
      "sql-invalid",
      "only SELECT and WITH statements are allowed",
    );
  }

  // System catalog block
  if (SYSTEM_CATALOG_PATTERN.test(stripped)) {
    throw new ToolError("sql-blocked", "system catalog access is blocked");
  }

  // DML/DDL keyword block (catches CTE-DML like `WITH x AS (DELETE FROM …)`)
  const forbidden = FORBIDDEN_PATTERN.exec(stripped);
  if (forbidden != null) {
    throw new ToolError(
      "sql-blocked",
      `forbidden keyword '${forbidden[1]?.toUpperCase()}' in query`,
    );
  }
}
