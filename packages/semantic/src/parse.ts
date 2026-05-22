/* SPDX-License-Identifier: Apache-2.0 */
import { parse as parseYaml } from "yaml";
import type { ZodError } from "zod";
import { EntitySchema } from "./schema.js";
import type { Entity } from "./types.js";
import { ParseError } from "./errors.js";

export type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E };

function formatZodError(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path =
        issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
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
