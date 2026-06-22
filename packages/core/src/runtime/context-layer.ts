/* SPDX-License-Identifier: Apache-2.0 */
import {
  type ContextDocument,
  type ContextLayer,
  defineContextLayer,
} from "@arivie/context";
import { ArivieConfigError } from "../errors.js";

/** `usage_mode` on a knowledge page (ADR 0003 / ktx parity). */
export type UsageMode = "always" | "auto" | "never";

/** The context layer loaded for an app, plus the derived serving slices. */
export interface LoadedContext {
  layer: ContextLayer;
  documents: ContextDocument[];
  /** Bodies of `usage_mode: always` knowledge pages — injected into every agent. */
  alwaysKnowledge: string[];
}

/** Read a knowledge page's usage_mode from its frontmatter; defaults to `auto`. */
export function usageModeOf(document: ContextDocument): UsageMode {
  const raw = document.frontmatter["usage_mode"];
  return raw === "always" || raw === "never" ? raw : "auto";
}

/**
 * Load the app's context layer (ADR 0003). The declarative knowledge pillar:
 * `usage_mode: always` pages inject into instructions, `auto` pages are
 * retrievable via the context tools, `never` pages load only for reference
 * integrity. Fails fast on error-severity load issues (mirrors manifest
 * validation). Returns `undefined` when no `context` is configured.
 */
export async function loadAppContext(
  config: { context?: { root: string } },
): Promise<LoadedContext | undefined> {
  if (config.context === undefined) return undefined;

  const layer = defineContextLayer({ root: config.context.root });
  const { issues } = await layer.load();

  const errors = issues.filter((issue) => issue.severity === "error");
  if (errors.length > 0) {
    const lines = errors.map((e) => `  - ${e.message}${e.path ? ` (${e.path})` : ""}`);
    throw new ArivieConfigError(`Context layer failed to load:\n${lines.join("\n")}`);
  }

  const documents = layer.all();
  const alwaysKnowledge = documents
    .filter((doc) => doc.kind === "knowledge" && usageModeOf(doc) === "always")
    .map((doc) => doc.body ?? "")
    .filter((body) => body.trim().length > 0);

  return { layer, documents, alwaysKnowledge };
}
