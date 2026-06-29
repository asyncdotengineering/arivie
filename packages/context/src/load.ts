/* SPDX-License-Identifier: Apache-2.0 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { parse as parseYaml } from "yaml";
import type {
  ContextDocument,
  ContextLayerConfig,
  ContextLayerLoadResult,
  ContextValidationIssue,
} from "./index.js";
import { createProvenanceRecord } from "./provenance.js";
import {
  parseMarkdownFrontmatter,
  readStringArrayField,
  readStringField,
  resolveSchemaDefinition,
  validateOrphanedRefs,
  validateStandardSchemaValue,
} from "./validate.js";

const CONTEXT_EXTENSIONS = new Set([".md", ".markdown", ".yml", ".yaml"]);
const KNOWN_CONTEXT_TYPES = new Set(["knowledge", "playbook", "reference"]);

function normalizePath(path: string): string {
  return path.split("\\").join("/");
}

function pathWithoutExtension(rootRelativePath: string): string {
  const ext = extname(rootRelativePath);
  return normalizePath(
    ext.length > 0 ? rootRelativePath.slice(0, -ext.length) : rootRelativePath,
  );
}

function walkContextFiles(root: string): string[] {
  const files: string[] = [];

  function walk(currentDir: string): void {
    const entries = readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const ext = extname(entry.name).toLowerCase();
      if (CONTEXT_EXTENSIONS.has(ext)) {
        files.push(normalizePath(relative(root, fullPath)));
      }
    }
  }

  walk(root);
  return files.sort();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function synthesizeCatalog(documents: readonly ContextDocument[]): string {
  const lines = documents
    .filter((document) => document.kind === "knowledge")
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((document) => {
      const type = document.type ?? "knowledge";
      const description =
        readStringField(document.frontmatter, "description") ??
        readStringField(document.frontmatter, "title") ??
        "";
      return description.length > 0
        ? `- [${type}] ${document.id} — ${description}`
        : `- [${type}] ${document.id}`;
    });
  return lines.join("\n");
}

async function loadKnowledgeDocument(
  config: ContextLayerConfig,
  filePath: string,
  raw: string,
  issues: ContextValidationIssue[],
): Promise<ContextDocument | undefined> {
  const { frontmatter, body } = parseMarkdownFrontmatter(raw);
  const schemaResolution = resolveSchemaDefinition(
    readStringField(frontmatter, "schema"),
    "knowledge",
    config.schemas ?? [],
    filePath,
  );

  if ("severity" in schemaResolution) {
    issues.push(schemaResolution);
    return undefined;
  }

  const id = readStringField(frontmatter, "id") ?? pathWithoutExtension(filePath);
  const type = readStringField(frontmatter, "type") ?? "knowledge";
  const refs = readStringArrayField(frontmatter, "refs");
  const validation: "passed" | "failed" = "passed";

  if (!KNOWN_CONTEXT_TYPES.has(type)) {
    issues.push({
      severity: "warning",
      message: `unknown context type "${type}"`,
      path: filePath,
    });
  }

  const document: ContextDocument = {
    id,
    kind: "knowledge",
    type,
    schema: schemaResolution.schemaId,
    path: filePath,
    frontmatter,
    body,
    provenance: [createProvenanceRecord({ raw, validation })],
  };

  if (refs !== undefined) {
    document.refs = refs;
  }

  return document;
}

async function loadExecutableDocument(
  config: ContextLayerConfig,
  filePath: string,
  raw: string | Buffer,
  issues: ContextValidationIssue[],
): Promise<ContextDocument | undefined> {
  const text = typeof raw === "string" ? raw : raw.toString("utf8");
  let parsed: unknown;
  try {
    parsed = parseYaml(text);
  } catch (err) {
    const message = err instanceof Error ? err.message : "YAML parse failed";
    issues.push({
      severity: "error",
      message,
      path: filePath,
    });
    return undefined;
  }

  if (!isRecord(parsed)) {
    issues.push({
      severity: "error",
      message: "Executable context file must be a YAML mapping",
      path: filePath,
    });
    return undefined;
  }

  const schemaResolution = resolveSchemaDefinition(
    readStringField(parsed, "schema"),
    "executable",
    config.schemas ?? [],
    filePath,
  );

  if ("severity" in schemaResolution) {
    issues.push(schemaResolution);
    return undefined;
  }

  const { definition, schemaId } = schemaResolution;
  if (definition.schema === undefined) {
    issues.push({
      severity: "error",
      message: `Executable schema "${schemaId}" has no validator`,
      path: filePath,
    });
    return undefined;
  }

  const validationResult = await validateStandardSchemaValue(definition.schema, parsed);
  const validation: "passed" | "failed" = validationResult.ok ? "passed" : "failed";

  if (!validationResult.ok) {
    issues.push({
      severity: "error",
      message: validationResult.message,
      path: filePath,
      detail: { schema: schemaId },
    });
  }

  const id = readStringField(parsed, "id") ?? pathWithoutExtension(filePath);
  const refs = readStringArrayField(parsed, "refs");

  const document: ContextDocument = {
    id,
    kind: "executable",
    schema: schemaId,
    path: filePath,
    frontmatter: {},
    data: validationResult.ok ? validationResult.value : parsed,
    provenance: [createProvenanceRecord({ raw, validation })],
  };

  if (refs !== undefined) {
    document.refs = refs;
  }

  return document;
}

export async function loadContextLayer(
  config: ContextLayerConfig,
): Promise<ContextLayerLoadResult> {
  const issues: ContextValidationIssue[] = [];
  const documents: ContextDocument[] = [];
  const schemas = config.schemas ?? [];
  const filePaths = walkContextFiles(config.root);
  let catalogFromIndex: string | undefined;

  for (const filePath of filePaths) {
    const absolutePath = join(config.root, filePath);
    const raw = readFileSync(absolutePath);
    const ext = extname(filePath).toLowerCase();

    if (filePath === "index.md") {
      const { body } = parseMarkdownFrontmatter(raw.toString("utf8"));
      catalogFromIndex = body;
      continue;
    }

    let document: ContextDocument | undefined;
    if (ext === ".md" || ext === ".markdown") {
      document = await loadKnowledgeDocument(config, filePath, raw.toString("utf8"), issues);
    } else if (ext === ".yml" || ext === ".yaml") {
      document = await loadExecutableDocument(config, filePath, raw, issues);
    }

    if (document !== undefined) {
      documents.push(document);
    }
  }

  const idCounts = new Map<string, number>();
  for (const document of documents) {
    idCounts.set(document.id, (idCounts.get(document.id) ?? 0) + 1);
  }

  for (const [id, count] of idCounts) {
    if (count > 1) {
      const paths = documents.filter((doc) => doc.id === id).map((doc) => doc.path);
      issues.push({
        severity: "error",
        message: `Duplicate context document id "${id}"`,
        detail: { id, paths },
      });
    }
  }

  issues.push(...validateOrphanedRefs(documents));

  const catalog = catalogFromIndex ?? synthesizeCatalog(documents);

  return { documents, issues, catalog };
}
