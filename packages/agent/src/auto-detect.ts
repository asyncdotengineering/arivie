/* SPDX-License-Identifier: Apache-2.0 */
import { estimateTokens, type SemanticLayer } from "@arivie/semantic";
import type { ContextMode } from "./prompt.js";

const PRELOAD_TOKEN_CEILING = 8000;

function serializeLayer(layer: SemanticLayer): string {
  return JSON.stringify(
    [...layer.entities.values()].sort((a, b) => a.name.localeCompare(b.name)),
  );
}

/** RFC-002 §6.9 / RFC-003 v2 — auto resolves to preload or indexed only. */
export function autoDetectMode(layer: SemanticLayer): ContextMode {
  const totalTokens = estimateTokens(serializeLayer(layer));
  if (totalTokens < PRELOAD_TOKEN_CEILING) {
    return "preload";
  }
  return "indexed";
}
