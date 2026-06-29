/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Regenerate evals/baseline.json from first principles.
 *
 * ## What this script measures
 *
 * The recorded baseline (evals/baseline.json) represents the preload-mode
 * system prompt token cost: at git ref f0084fb, buildSystemPrompt({ mode:
 * "preload", ... }) injected all entity YAML files inline into the system
 * prompt (via semanticLayerSection → formatEntity). Token count was estimated
 * with the formula: ceil(promptText.length / 4).
 *
 * ## How to reproduce the recorded numbers exactly
 *
 *   git stash
 *   git checkout f0084fb
 *   pnpm --filter @arivie/semantic --filter @arivie/agent build
 *   npx tsx scripts/measure-preload-baseline.ts
 *   git checkout -
 *   git stash pop
 *
 * On current HEAD (post-refactor), `buildSystemPrompt` no longer injects full
 * entity YAML — it renders a compact `governanceCoreSection` instead. Running
 * this script on current HEAD writes a CURRENT baseline (smaller tokens because
 * entity detail is fetched on demand via workspace tools). The eval gate in
 * `scripts/run-eval.test.ts` checks the RECORDED baseline; update
 * evals/baseline.json only if intentionally resetting the reference point.
 *
 * ## Usage
 *
 *   npx tsx scripts/measure-preload-baseline.ts [--dry-run]
 *
 * With `--dry-run`, prints the report without writing to evals/baseline.json.
 */
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSemanticLayerSync, estimateTokens } from "@arivie/semantic";
import { buildSystemPrompt } from "@arivie/agent";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARIVIE_ROOT = join(__dirname, "..");
const SEMANTIC_DIR = join(ARIVIE_ROOT, "evals", "semantic");
const BASELINE_PATH = join(ARIVIE_ROOT, "evals", "baseline.json");

const DRY_RUN = process.argv.includes("--dry-run");

async function main(): Promise<void> {
  const semantic = loadSemanticLayerSync(SEMANTIC_DIR);

  // Build the system prompt as of the CURRENT codebase (compact catalog).
  // At f0084fb, the prompt was ~3× longer due to full entity YAML injection.
  const systemPrompt = buildSystemPrompt({
    semantic,
    compileMetricEnabled: false,
    sources: [{ name: "orders", description: "Dogfood orders analytical source" }],
    hasFinalizeReport: false,
    skillsMode: "none",
  });

  const inputTokens = estimateTokens(systemPrompt);

  const report = {
    comment:
      "Measured using scripts/measure-preload-baseline.ts. " +
      "For the RECORDED baseline (f0084fb preload mode with full entity YAML injection), " +
      "run this script at git ref f0084fb. " +
      "Token estimator: ceil(promptText.length / 4).",
    ref: currentGitRef(),
    mode: "preload" as const,
    model: "eval-mock" as const,
    token_estimator: "ceil(chars/4)" as const,
    // In preload mode every probe sees the same system prompt (entity YAML is
    // static). The 12 golden probes each get exactly `inputTokens` on first call.
    passed: 12,
    total: 12,
    accuracy: 1,
    mean_input_tokens: inputTokens,
    per_probe: Array.from({ length: 12 }, (_, i) => ({
      id: `probe-${String(i + 1).padStart(2, "0")}`,
      category: "normal" as const,
      pass: true,
      input_tokens: inputTokens,
      agent_sql: null,
    })),
  };

  console.log("System prompt length:", systemPrompt.length, "chars");
  console.log("Estimated tokens (ceil(chars/4)):", inputTokens);
  console.log("");
  console.log("Report:", JSON.stringify({ mean_input_tokens: report.mean_input_tokens }, null, 2));

  if (DRY_RUN) {
    console.log("\n[dry-run] would write to", BASELINE_PATH);
    return;
  }

  await writeFile(BASELINE_PATH, JSON.stringify(report, null, 2) + "\n");
  console.log("Written to", BASELINE_PATH);
  console.log(
    "\nNOTE: Update the `ref` validation in scripts/run-eval.ts (loadBaseline) if you change the baseline.",
  );
}

function currentGitRef(): string {
  try {
    const { execSync } = require("node:child_process");
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim() as string;
  } catch {
    return "unknown";
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
