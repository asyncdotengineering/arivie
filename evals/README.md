# Arivie eval suite

Deterministic golden-SQL eval over a tiny dogfood semantic layer, used as the
accuracy + token gate for the navigation-by-default knowledge delivery (ADR 0006).

- `golden-queries/*.yml` — 12 golden probes (question + golden SQL + validation rules).
- `semantic/` — the dogfood semantic layer the probes run against.
- `baseline.json` — the **frozen preload baseline** (see below).
- Runner + gate: `scripts/run-eval.ts` (`pnpm eval`).

## What `pnpm eval` asserts

It builds the agent on the **current** tree (navigation mode), runs the 12 probes in
deterministic mock mode, and compares against `baseline.json`:

- **accuracy** must be `>=` the baseline accuracy, and
- **mean input tokens** must be `<` the baseline mean input tokens.

Exit 0 only if both hold. `loadBaseline()` in `scripts/run-eval.ts` additionally
REQUIRES `baseline.ref === "f0084fb" && baseline.mode === "preload" && model === "eval-mock" && total === 12`
— so the gate refuses any baseline that is not the genuine preload reference.

## What `baseline.json` is (and why it is frozen)

It records the **preload-mode** system-prompt cost at git ref **`f0084fb`** — the last
commit before the navigation rework. At that ref, `buildSystemPrompt({ mode: "preload" })`
injected every entity YAML inline (`semanticLayerSection` → `formatEntity`, rendering
`### Entity:` blocks). Recorded: 12/12 probes, `mean_input_tokens` **3073.58**, estimator
`ceil(promptText.length / 4)`.

Preload mode was **deleted in 3.0.0**, so the preload prompt no longer exists on `main`.
`baseline.json` is therefore a historical artifact: it is the "before" number the
navigation "after" is measured against. Do not regenerate it from `main` — there is
nothing preload to measure there (navigation yields ~2752 tokens, which is the *result*
being gated, not the baseline).

## Inspecting the current prompt cost

```sh
npx tsx scripts/measure-preload-baseline.ts        # report only; prints current (navigation) tokens
```

On `main` this prints `mode: navigation`. Passing `--write` here **refuses** (it will not
overwrite the frozen baseline with a non-preload number).

## Regenerating `baseline.json` (only if the golden set or token estimator changes)

The preload prompt only exists at `f0084fb`, so measure there in a throwaway worktree:

```sh
git worktree add /tmp/arivie-preload f0084fb
cd /tmp/arivie-preload
pnpm install
pnpm --filter @arivie/semantic --filter @arivie/agent build
# At f0084fb buildSystemPrompt takes a `mode` arg; measure the preload prompt:
npx tsx -e '
  import { loadSemanticLayerSync, estimateTokens } from "@arivie/semantic";
  import { buildSystemPrompt } from "@arivie/agent";
  const s = loadSemanticLayerSync("evals/semantic");
  const p = buildSystemPrompt({ mode: "preload", semantic: s, compileMetricEnabled: false,
    sources: [{ name: "orders", description: "Dogfood orders analytical source" }],
    hasFinalizeReport: false, skillsMode: "none" });
  console.log("preload mean_input_tokens:", estimateTokens(p));
'
cd - && git worktree remove /tmp/arivie-preload
```

Then update `evals/baseline.json` `mean_input_tokens` to the printed value (keep
`ref: "f0084fb"`, `mode: "preload"`, `model: "eval-mock"`, `total: 12`). The
`scripts/measure-preload-baseline.ts --write` path writes this shape automatically only
when run on a genuine `f0084fb` preload tree.
