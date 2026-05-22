/* SPDX-License-Identifier: Apache-2.0 */
import { parse as parseYaml } from "yaml";
import type { ZodError } from "zod";
import { EntitySchema } from "./schema.js";
import type { Entity } from "./types.js";
import { ParseError } from "./errors.js";

export type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E };

// Common shape-drift mistakes the YAML schema rejects, with the
// canonical fix the writer probably meant. Surfaced as a hint line on
// `unrecognized_keys` / `invalid_type` errors so first-time users
// don't have to scroll the README to figure out the right spelling.
const DID_YOU_MEAN: Record<string, string> = {
  // joins[]
  "joins.*.entity": 'joins[].entity → joins[].to (the entity name being joined to)',
  "joins.*.cardinality":
    'joins[].cardinality → joins[].type (one of "one_to_many", "many_to_one", "one_to_one")',
  // segments[]
  "segments.*.where": "segments[].where → segments[].sql (the SQL fragment)",
  // dimensions[]
  "dimensions.*.pii":
    "dimensions[].pii is not part of the schema. Mark PII inline in the dimension's description for now.",
  // type strings
  type_integer:
    'dimensions[].type "integer" → "numeric" (covers integer + decimal)',
  type_string:
    'dimensions[].type "string" → "text" (matches the SQL type name)',
  type_float:
    'dimensions[].type "float" → "numeric"',
};

function lookupHint(path: string, message: string): string | undefined {
  // Wildcard matches: joins.0.entity → joins.*.entity
  const wildcard = path.replace(/\.\d+\./g, ".*.").replace(/\.\d+$/, ".*");
  if (DID_YOU_MEAN[wildcard] != null) return DID_YOU_MEAN[wildcard];
  // Type-specific: "Invalid option ... received 'integer'"
  if (/received\s*['"](integer)['"]/.test(message)) return DID_YOU_MEAN.type_integer;
  if (/received\s*['"](string)['"]/.test(message)) return DID_YOU_MEAN.type_string;
  if (/received\s*['"](float)['"]/.test(message)) return DID_YOU_MEAN.type_float;
  return undefined;
}

function formatZodError(error: ZodError): string {
  const seenHints = new Set<string>();
  const lines = error.issues.flatMap((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    const base = `${path}: ${issue.message}`;
    const hint = lookupHint(path, issue.message);
    if (hint && !seenHints.has(hint)) {
      seenHints.add(hint);
      return [base, `  → hint: ${hint}`];
    }
    return [base];
  });
  return lines.join("; ");
}

export function parseEntity(
  filePath: string,
  raw: string,
): Result<Entity, ParseError> {
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "YAML parse failed";
    return {
      ok: false,
      error: new ParseError({
        code: "YAML_PARSE_ERROR",
        filePath,
        message,
      }),
    };
  }

  const result = EntitySchema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      error: new ParseError({
        code: "ENTITY_VALIDATION_ERROR",
        filePath,
        message: formatZodError(result.error),
      }),
    };
  }

  return { ok: true, value: result.data };
}
