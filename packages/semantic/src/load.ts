/* SPDX-License-Identifier: Apache-2.0 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { parseEntity } from "./parse.js";
import { lint } from "./lint.js";
import { GlossarySchema } from "./schema.js";
import type { Catalog, Entity, SemanticLayer } from "./types.js";
import { LoadError, ParseError } from "./errors.js";

/** Read an optional `glossary.yml` at the semantic root (ADR 0004 — stolen-as-art from Atlas's ambiguous-term idea, our own schema). */
function loadGlossary(rootDir: string): Catalog["glossary"] {
  const path = join(rootDir, "glossary.yml");
  if (!existsSync(path)) return undefined;
  const doc = parseYaml(readFileSync(path, "utf8"));
  // A YAML mapping `{ terms: [...] }` (so the file is a mapping — plays nicely
  // when the same dir is also a context-layer root). Bare-array also accepted.
  const terms = doc != null && typeof doc === "object" && !Array.isArray(doc) ? (doc as { terms?: unknown }).terms : doc;
  const parsed = GlossarySchema.safeParse(terms);
  if (!parsed.success) {
    throw new LoadError({
      code: "SEMANTIC_LOAD_ERROR",
      filePath: path,
      message: `glossary.yml is invalid: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
      errors: [],
    });
  }
  return parsed.data;
}

function buildCatalog(
  entities: Map<string, Entity>,
  sourceFiles: string[],
): Catalog {
  const catalogEntities = [...entities.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entity) => ({
      name: entity.name,
      description: entity.description,
      keywords: entity.name.split(/[_\s-]+/).filter(Boolean),
    }));

  return {
    entities: catalogEntities,
    generated_at: new Date().toISOString(),
    source_files: [...sourceFiles].sort(),
  };
}

function loadSemanticLayerFromEntitiesDir(entitiesDir: string): SemanticLayer {
  const entries = readdirSync(entitiesDir, { withFileTypes: true });
  const yamlFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".yml"))
    .map((entry) => entry.name)
    .sort();

  const entities = new Map<string, Entity>();
  const parseErrors: ParseError[] = [];
  const sourceFiles: string[] = [];

  for (const fileName of yamlFiles) {
    const filePath = join(entitiesDir, fileName);
    const raw = readFileSync(filePath, "utf8");
    const result = parseEntity(filePath, raw);
    if (!result.ok) {
      parseErrors.push(result.error);
      continue;
    }
    entities.set(result.value.name, result.value);
    sourceFiles.push(`entities/${fileName}`);
  }

  if (parseErrors.length > 0) {
    throw new LoadError({
      code: "SEMANTIC_LOAD_ERROR",
      filePath: entitiesDir,
      message: `Failed to load ${parseErrors.length} semantic entity file(s)`,
      errors: parseErrors,
    });
  }

  const layer: SemanticLayer = {
    entities,
    catalog: buildCatalog(entities, sourceFiles),
  };

  const report = lint(layer);
  if (report.errors.length > 0) {
    const lintParseErrors: ParseError[] = report.errors.map(
      (issue) =>
        new ParseError({
          code: issue.code,
          filePath: issue.filePath ?? entitiesDir,
          message: issue.message,
        }),
    );
    throw new LoadError({
      code: "SEMANTIC_LOAD_ERROR",
      filePath: entitiesDir,
      message: `Semantic layer lint failed with ${report.errors.length} error(s)`,
      errors: lintParseErrors,
    });
  }

  return layer;
}

/** Eager factory-time load (RFC-002 §7.6); throws `LoadError` on parse failures. */
export function loadSemanticLayerSync(rootDir: string): SemanticLayer {
  const entitiesDir = join(rootDir, "entities");
  const layer = loadSemanticLayerFromEntitiesDir(entitiesDir);
  const glossary = loadGlossary(rootDir);
  if (glossary !== undefined) {
    return { ...layer, catalog: { ...layer.catalog, glossary } };
  }
  return layer;
}

export async function loadSemanticLayer(rootDir: string): Promise<SemanticLayer> {
  return loadSemanticLayerSync(rootDir);
}
