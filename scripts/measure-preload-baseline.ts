/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Measure the analytics system-prompt token cost, and (only at the right ref)
 * regenerate evals/baseline.json.
 *
 * ## What evals/baseline.json is
 *
 * A FROZEN historical artifact: the PRELOAD-mode system-prompt token cost at git
 * ref `f0084fb` (the last commit before the navigation rework / ADR 0006). At that
 * ref, `buildSystemPrompt({ mode: "preload", ... })` injected every entity YAML
 * inline (via `semanticLayerSection` → `formatEntity`, rendering `### Entity:` blocks).
 * Tokens estimated as `ceil(promptText.length / 4)`. Recorded numbers: 12/12 probes,
 * mean_input_tokens 3073.58. The eval gate (`scripts/run-eval.ts` → `loadBaseline`)
 * REQUIRES `ref === "f0084fb" && mode === "preload"`, so a baseline captured anywhere
 * else is rejected by design.
 *
 * ## Why this script will NOT overwrite the baseline on HEAD
 *
 * Preload mode was DELETED in 3.0.0 — on HEAD `buildSystemPrompt` renders the compact
 * `governanceCoreSection` (no `### Entity:` blocks) and entity detail is fetched on
 * demand via workspace tools. Measuring HEAD yields the NAVIGATION cost, not preload.
 * Writing that into baseline.json would make the gate compare navigation-vs-navigation
 * (gutting the −10.5% assertion). This script therefore REFUSES to write unless it is
 * running on a genuine preload tree at ref f0084fb. By default it only REPORTS.
 *
 * ## Regenerating the baseline (only if the golden set or estimator changes)
 *
 * See evals/README.md → "Regenerating baseline.json". In short: check out f0084fb in a
 * git worktree, where preload mode still exists, and measure there.
 *
 * ## Usage
 *
 *   npx tsx scripts/measure-preload-baseline.ts            # report current prompt cost (no write)
 *   npx tsx scripts/measure-preload-baseline.ts --write    # write baseline.json — ONLY succeeds on a preload tree at f0084fb
 */
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { loadSemanticLayerSync, estimateTokens } from "@arivie/semantic";
import { buildSystemPrompt } from "@arivie/agent";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARIVIE_ROOT = join(__dirname, "..");
const SEMANTIC_DIR = join(ARIVIE_ROOT, "evals", "semantic");
const BASELINE_PATH = join(ARIVIE_ROOT, "evals", "baseline.json");

const WRITE = process.argv.includes("--write");
const BASELINE_REF = "f0084fb";

function currentGitRef(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

async function main(): Promise<void> {
  const semantic = loadSemanticLayerSync(SEMANTIC_DIR);
  const systemPrompt = buildSystemPrompt({
    semantic,
    compileMetricEnabled: false,
    sources: [{ name: "orders", description: "Dogfood orders analytical source" }],
    hasFinalizeReport: false,
    skillsMode: "none",
  });

  // Preload injected full entity detail as "### Entity:" blocks; navigation does not.
  const isPreloadTree = systemPrompt.includes("### Entity:");
  const ref = currentGitRef();
  const inputTokens = estimateTokens(systemPrompt);
  const mode = isPreloadTree ? "preload" : "navigation";

  console.log(`ref: ${ref}`);
  console.log(`mode (detected from prompt): ${mode}`);
  console.log(`system prompt: ${systemPrompt.length} chars`);
  console.log(`estimated tokens (ceil(chars/4)): ${inputTokens}`);

  if (!WRITE) {
    console.log("\n(report only — pass --write to regenerate baseline.json)");
    return;
  }

  if (!isPreloadTree || ref !== BASELINE_REF) {
    console.error(
      `\nREFUSING to write evals/baseline.json.\n` +
        `  baseline.json is the FROZEN preload reference (ref ${BASELINE_REF}, mode preload).\n` +
        `  This tree is mode "${mode}" at ref "${ref}".\n` +
        `  Writing it here would corrupt the eval gate's reference point.\n` +
        `  To regenerate, see evals/README.md → "Regenerating baseline.json" (use a worktree of ${BASELINE_REF}).`,
    );
    process.exit(1);
  }

  const report = {
    comment:
      `Frozen preload baseline captured at ref ${BASELINE_REF} via scripts/measure-preload-baseline.ts --write. ` +
      `Token estimator: ceil(promptText.length / 4). See evals/README.md.`,
    ref: BASELINE_REF,
    mode: "preload" as const,
    model: "eval-mock" as const,
    token_estimator: "ceil(chars/4)" as const,
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
  await writeFile(BASELINE_PATH, JSON.stringify(report, null, 2) + "\n");
  console.log("\nWritten to", BASELINE_PATH);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
