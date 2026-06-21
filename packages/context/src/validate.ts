/* SPDX-License-Identifier: Apache-2.0 */
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { parse as parseYaml } from "yaml";
import type { ContextSchemaDefinition } from "./schemas.js";
import type { ContextValidationIssue } from "./index.js";

export interface ParsedMarkdown {
  frontmatter: Record<string, unknown>;
  body: string;
}

export function parseMarkdownFrontmatter(raw: string): ParsedMarkdown {
  const trimmed = raw.startsWith("\ufeff") ? raw.slice(1) : raw;
  if (!trimmed.startsWith("---")) {
    return { frontmatter: {}, body: trimmed };
  }

  const end = trimmed.indexOf("\n---", 3);
  if (end === -1) {
    return { frontmatter: {}, body: trimmed };
  }

  const frontmatterBlock = trimmed.slice(3, end).replace(/^\n/, "");
  const body = trimmed.slice(end + 4).replace(/^\n/, "");

  let frontmatter: Record<string, unknown> = {};
  if (frontmatterBlock.trim().length > 0) {
    const parsed = parseYaml(frontmatterBlock);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      frontmatter = parsed as Record<string, unknown>;
    }
  }

  return { frontmatter, body };
}

export function resolveSchemaDefinition(
  explicitSchemaId: string | undefined,
  kind: "knowledge" | "executable",
  schemas: readonly ContextSchemaDefinition[],
  filePath: string,
): { schemaId: string; definition: ContextSchemaDefinition } | ContextValidationIssue {
  const catalog = schemas.filter((entry) => entry.kind === kind);

  if (explicitSchemaId !== undefined && explicitSchemaId.length > 0) {
    const match = schemas.find((entry) => entry.id === explicitSchemaId);
    if (match === undefined) {
      return {
        severity: "error",
        message: `Unknown schema id "${explicitSchemaId}"`,
        path: filePath,
      };
    }
    if (match.kind !== kind) {
      return {
        severity: "error",
        message: `Schema "${explicitSchemaId}" is kind "${match.kind}", expected "${kind}"`,
        path: filePath,
      };
    }
    return { schemaId: match.id, definition: match };
  }

  if (catalog.length === 1) {
    const [only] = catalog;
    if (only === undefined) {
      return {
        severity: "error",
        message: `No ${kind} schema configured for file`,
        path: filePath,
      };
    }
    return { schemaId: only.id, definition: only };
  }

  if (catalog.length === 0) {
    return {
      severity: "error",
      message: `No ${kind} schema configured for file`,
      path: filePath,
    };
  }

  return {
    severity: "error",
    message: `Ambiguous ${kind} schema: specify schema id (found ${catalog.length})`,
    path: filePath,
  };
}

export async function validateStandardSchemaValue(
  schema: StandardSchemaV1<unknown>,
  value: unknown,
): Promise<{ ok: true; value: unknown } | { ok: false; message: string }> {
  let result = schema["~standard"].validate(value);
  if (result instanceof Promise) {
    result = await result;
  }

  if (result.issues) {
    const message = result.issues
      .map((issue) => {
        const path = issue.path
          ?.map((segment) => (typeof segment === "object" ? segment.key : segment))
          .join(".");
        return path ? `${path}: ${issue.message}` : issue.message;
      })
      .join("; ");
    return { ok: false, message };
  }

  return { ok: true, value: result.value };
}

export function readStringField(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function readStringArrayField(
  record: Record<string, unknown>,
  key: string,
): string[] | undefined {
  const value = record[key];
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value.filter((entry): entry is string => typeof entry === "string");
  return items.length > 0 ? items : undefined;
}

export function validateOrphanedRefs(
  documents: readonly { id: string; refs?: string[]; path: string }[],
): ContextValidationIssue[] {
  const ids = new Set(documents.map((doc) => doc.id));
  const issues: ContextValidationIssue[] = [];

  for (const doc of documents) {
    if (doc.refs === undefined) {
      continue;
    }
    for (const ref of doc.refs) {
      if (!ids.has(ref)) {
        issues.push({
          severity: "error",
          message: `Orphaned reference "${ref}" from document "${doc.id}"`,
          path: doc.path,
          detail: { ref, documentId: doc.id },
        });
      }
    }
  }

  return issues;
}
