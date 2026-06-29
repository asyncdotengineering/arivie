# RFC: Knowledge delivery — navigation-by-default, cached governance core, OKF-shaped knowledge layer

**Category:** Architectural Change
**Author:** Mithushan CJ
**Date:** 2026-06-29
**Status:** Draft
**Reviewers:** —
**Related:** [ADR 0006](../docs/adr/0006-knowledge-delivery-navigation-default-okf.md) (decision), ADR 0002 (leaf/spine ownership), ADR 0003 (context layer + skills), ADR 0004 (product angle + Measure gap). Executed by `/loop-engineer`.

---

## 1. Problem Statement

`@arivie/plugin-analytics` preloads the **entire** semantic layer into the system prompt on every request (`buildSystemPrompt({ mode: "preload" })`). This (a) dilutes the effective context window (~128k–200k effective on a 1M model), (b) adds attention latency, (c) does not scale past a few dozen entities, and (d) caps `mode: "auto"` at an 8k-token ceiling beyond which it **throws** (`autoDetectMode` → `"indexed"` → `ArivieConfigError`). A built navigation path (`buildSystemPromptIndexed`) exists but is gated off.

Separately, the knowledge layer (`@arivie/context`) cannot hold typed procedural/prose knowledge as navigable, cross-linked concepts — so business nuance (e.g. an eyewear store's return/refund/remake policy) has no first-class home linked to the measures it governs.

**Success =** one navigation-by-default delivery model in which: a small, byte-stable governance core (catalog + glossary + discipline) rides the prompt cache; entity detail and knowledge concepts are fetched on demand as tool results *after* the cache breakpoint; the knowledge layer holds OKF-shaped `playbook`/`reference` concepts cross-linked to semantic entities; and golden-SQL eval accuracy on `with-pos-fnb` is **≥ the preload baseline** at **lower per-request tokens**.

## 2. Background

- **Preload is the default and the only un-gated path.** `resolveContextMode` (`packages/plugin-analytics/src/analytics.ts:100`) resolves `mode === "auto"` via `autoDetectMode`, else falls back to `"preload"`; `"indexed"` throws `"indexed mode not supported in plugin-analytics v1"` (`analytics.ts:104-108`). `buildSystemPrompt` is invoked with the resolved mode in `setup()` (`analytics.ts:155`).
- **The navigation path is already written.** `buildSystemPromptIndexed` + `WORKSPACE_NAVIGATION_RULE` (`packages/agent/src/prompt.ts:197-225`) instruct the agent to discover entities via Mastra Workspace tools (`mastra_workspace_list_files("./entities")`, `mastra_workspace_read_file(...)`) instead of preloading. `autoDetectMode` (`packages/agent/src/auto-detect.ts`) already returns `"indexed"` above an 8k-token ceiling.
- **The governance-core material already exists.** `CatalogSchema` (`packages/semantic/src/schema.ts:118`) carries per-entity `keywords` + an optional `glossary`; `GlossaryTermSchema` (`schema.ts:106`) carries `status: "defined" | "ambiguous"`. `formatCatalog` and `glossarySection` already render them (`packages/agent/src/prompt.ts:259, 464`).
- **The context layer is half-way to OKF.** `ContextDocument` (`packages/context/src/index.ts`) already has `kind: "knowledge" | "executable"`, free-form `frontmatter`, `body`, and **`refs: string[]`** (cross-links, read from frontmatter in `loadKnowledgeDocument`, `packages/context/src/load.ts`). `ContextLayerConfig.indexing.mode: "none" | "lexical" | "hybrid"` is already declared. There is no `type` discriminator and no `index.md` catalog convention.
- **The eval harness already runs both modes.** `scripts/run-eval.ts` defines `ArivieEvalMode = "preload" | "indexed"` and `--mode`; probes live in `evals/golden-queries/*.yml` (12 probes) over `evals/semantic/`. It does not yet *compare* the two modes or assert tokens.
- **Cache hazard (must fix):** `temporalSection()` injects the current time into the system prompt (`packages/agent/src/prompt.ts:297, 318`). Any per-request value in the cached prefix invalidates the cache on every request (prefix-match invariant). Navigation's cache benefit is void unless temporal grounding moves *after* the breakpoint.
- **ktx (Kaelio/ktx)** ships navigation-only as production default (`discover → read → query`, hybrid+RRF retrieval) — live proof the path works. It has **no** always-inject core; Arivie's differentiated bet is governance-in-cache (ADR 0006).

> Interface shape considered and rejected (ADR 0006): a `preload | auto | indexed` mode flag retained "for flexibility." Rejected as capability sprawl — one default, no matrix.

## 3. Strict Requirements

- **REQ-1:** `@arivie/plugin-analytics` has exactly one delivery path: navigation. Remove `mode` from `AnalyticsPluginConfig`, remove `resolveContextMode`/`autoDetectMode` usage from the plugin, and remove the `"indexed mode not supported"` throw. **Breaking → 3.0.0.**
- **REQ-2:** The system prompt is split at a cache boundary into (a) a **byte-stable governance core** — preamble, discipline rules, catalog (entity names + descriptions + keywords + join skeleton), full glossary — and (b) everything per-request. No per-request value (timestamp, user question, retrieved detail) appears in the governance core.
- **REQ-3:** Entity detail (measures/dimensions/joins/hints/sample_values/example SQL) is **not** in the system prompt; the agent fetches it on demand via Mastra Workspace navigation tools, landing in `messages` as tool results.
- **REQ-4:** Temporal grounding is delivered per-request **after** the cache breakpoint (not in the governance core).
- **REQ-5:** `@arivie/context` recognizes a `type` frontmatter discriminator on knowledge documents, with first-class `playbook` and `reference` types (plus the existing default). Unknown `type` values are tolerated (warning, not rejection), per OKF.
- **REQ-6:** The context layer emits/consumes an `index.md` catalog per knowledge root: a listing of concepts (`type`, `title`, one-line description) used as the navigable, cacheable entry tier. A missing `index.md` is non-fatal (generated/synthesized).
- **REQ-7:** A knowledge concept can cross-link to a semantic entity or measure via a typed ref (`semantic:<entity>` or `semantic:<entity>.<measure>`) carried in the existing `refs` field. Orphaned semantic refs surface as validation warnings.
- **REQ-8:** Golden-SQL eval on `with-pos-fnb` shows navigation accuracy **≥** preload baseline AND lower mean per-request input tokens. `scripts/run-eval.ts` graduates into a gate that runs both modes and exits non-zero on regression.
- **REQ-9:** No new front-door concepts; reuse `ContextDocument.refs`, `CatalogSchema`, `buildSystemPromptIndexed`, and the existing Workspace tools. (ADR 0002 — don't rebuild leaves.)

## 4. Interface Specification

### 4.1 `AnalyticsPluginConfig` (modified, breaking)
- **Location:** `packages/plugin-analytics/src/analytics.ts`
- **Change:** remove the `mode?: "auto" | "preload"` field. Delete `resolveContextMode`. The plugin no longer imports `autoDetectMode`.
- **Error cases:** a config still passing `mode` fails typecheck (intended breaking signal); document in the changeset.

### 4.2 `buildSystemPrompt` (modified)
- **Location:** `packages/agent/src/prompt.ts`
- **Signature:** `buildSystemPrompt(opts: { semantic: SemanticLayer; compileMetricEnabled: boolean; sources?: SourceDescriptor[]; hasFinalizeReport?: boolean; skillsMode?: SkillsMode }) -> string`
- **Behavior:** drop the `mode` param and the `mode === "preload"` branch; always render the governance core (§4.3) + the navigation body (`buildSystemPromptIndexed` content) + discipline sections. Returns the **governance core only** (stable); per-request content is composed by the caller after the breakpoint.
- **Error cases:** empty semantic layer → governance core with an empty catalog (no throw), matching `loadSemanticLayerAtSetup`'s empty-layer behavior.

### 4.3 `governanceCoreSection` (new)
- **Location:** `packages/agent/src/prompt.ts`
- **Signature:** `governanceCoreSection(semantic: SemanticLayer) -> string`
- **Behavior:** renders catalog (reuse `formatCatalog`) + join-graph skeleton (entity → joined-entity names only) + full glossary (reuse `glossarySection`). No measures/dimensions/sample_values. Deterministic ordering (alphabetical) so output is byte-stable.

### 4.4 Per-request assembly + cache breakpoint
- **Location:** `packages/core/src/define-app.ts` (agent build) and `packages/core/src/runtime/mastra-executor.ts` (call path)
- **Behavior:** the Mastra agent `instructions` = governance core (stable). Temporal grounding (REQ-4) and the user turn are delivered as message content. Set the Anthropic cache breakpoint on the last governance-core block via provider options on the model call (`providerOptions.anthropic.cacheControl = { type: "ephemeral" }`), so tools + governance core are cached and retrieved tool-results/messages fall after it.
- **Error cases:** non-Anthropic models — cache markers are ignored (no error); document as a known limitation (cf. ktx's honest surfacing).

### 4.5 `type` discriminator + concept types (new)
- **Location:** `packages/context/src/load.ts`, `packages/context/src/index.ts`
- **Change:** read `type` from knowledge frontmatter; add `type?: string` to `ContextDocument`. Recognize `playbook` and `reference` as first-class (surfaced in `arivie info` and to the agent). Unknown types load with a warning issue, not an error (REQ-5).

### 4.6 `index.md` catalog (new)
- **Location:** `packages/context/src/load.ts` (consume), `packages/context/src/index.ts` (`ContextLayer.index(): string`)
- **Behavior:** if `index.md` exists at a knowledge root, treat it as the catalog tier; else synthesize one from loaded concepts (`type`, `title`/`id`, `description`). Exposed for inclusion in the governance core / context retriever.

### 4.7 Semantic cross-link refs (new convention)
- **Location:** `packages/context/src/validate.ts` (validation), consumed where entity detail is rendered
- **Behavior:** `refs` entries matching `^semantic:` resolve against the loaded `SemanticLayer`. Form: `semantic:<entity>` or `semantic:<entity>.<measure>`. Unresolved → warning issue (extend `validateOrphanedRefs`). When an entity's detail is fetched (§4.3 navigation), linked knowledge concepts are surfaced alongside.

## 5. Architecture and System Dependencies

### 5.1 Structural Changes
- Remove: `mode` config + `resolveContextMode` (`plugin-analytics`); `mode`/preload branch in `buildSystemPrompt` (`agent`); the phantom `--filter '@arivie/deploy'` in root `package.json` build script + the frozen deploy-stub test (ADR 0004 residue).
- Add: `governanceCoreSection` (`agent`); `type`/`index.md`/`semantic:` ref handling (`context`); cache-breakpoint wiring (`core`); eval comparison gate (`scripts/`).

### 5.2 Service and Library Dependencies
Mastra Workspace tools (already used by `buildSystemPromptIndexed`), `@mastra/core` model provider options for `cacheControl`. No new deps.

### 5.3 Data and Schema Changes
No DB migrations. New optional frontmatter keys (`type`, `semantic:` refs) — additive to authored markdown. `with-pos-fnb` example gains a `knowledge/` dir with sample `playbook`/`reference` concepts + `index.md`.

### 5.4 Network and Performance Considerations
Expected: large drop in per-request input tokens (governance core ≪ full layer); cache reads at ~0.1× on the stable prefix; +1–N Workspace tool round-trips for detail (relevance-gated — skip for trivial single-entity questions). The eval gate (REQ-8) is the empirical check.

## 6. Pseudocode

```
# Plugin setup (navigation-only)
FUNCTION analyticsSetup(config):
    semantic = loadSemanticLayerAtSetup(config.semanticPath)   # no mode resolution
    instructions = buildSystemPrompt({ semantic, compileMetricEnabled, sources, skillsMode })
    RETURN { tools: analyticsTools + workspaceNavTools, instructions, dispose }

# Prompt assembly (stable core only)
FUNCTION buildSystemPrompt(opts):
    sections = [PREAMBLE, governanceCoreSection(opts.semantic), DISCIPLINE_SECTIONS,
                WORKSPACE_NAVIGATION_RULE, skillDiscipline(opts.skillsMode)]
    RETURN join(sections)        # NO temporalSection, NO measures/dims, NO user turn

# Per-request (core executor) — after the breakpoint
FUNCTION runPrompt(agent, userTurn, now):
    system = agent.instructions                      # cached prefix (+ cacheControl marker)
    messages = [systemReminder(temporalGrounding(now)), userTurn]
    RETURN agent.stream({ system, messages, providerOptions: cacheBreakpoint() })

# Context load (OKF type + refs)
FUNCTION loadKnowledgeDocument(file):
    fm = parseFrontmatter(file)
    type = fm.type ?? "knowledge"                     # tolerate unknown
    refs = fm.refs                                    # may include "semantic:orders.net_revenue"
    RETURN { id, kind: "knowledge", type, refs, body, ... }

# Eval gate
FUNCTION evalGate():
    base = runEvals(mode="preload");  nav = runEvals(mode="indexed")
    ASSERT nav.accuracy >= base.accuracy AND nav.meanInputTokens < base.meanInputTokens
    EXIT(0 if pass else 1)
```

## 7. Code Blueprint

```ts
// packages/agent/src/prompt.ts
export function governanceCoreSection(semantic: SemanticLayer): string {
  return [
    "## Semantic catalog", formatCatalog(semantic.catalog),
    joinSkeletonSection(semantic),          // entity -> joined entity names only
    glossarySection(semantic),              // full glossary incl. status: ambiguous
  ].filter(s => s.length > 0).join("\n\n");
}
// buildSystemPrompt: delete `mode` param + preload branch; always:
//   [PREAMBLE, governanceCoreSection(semantic), ...DISCIPLINE, WORKSPACE_NAVIGATION_RULE]
// temporalSection() is removed from here (moves to per-request, §4.4).

// packages/plugin-analytics/src/analytics.ts
// delete resolveContextMode + autoDetectMode import + the throw.
instructions: buildSystemPrompt({ semantic, compileMetricEnabled: compileMetric, sources: sourceDescriptors, skillsMode: "none" }),

// packages/context/src/index.ts
export interface ContextDocument { /* ...existing... */ type?: string }

// packages/context/src/load.ts (loadKnowledgeDocument)
const type = readStringField(frontmatter, "type") ?? "knowledge";
document.type = type; // refs already parsed; entries like "semantic:orders.net_revenue" pass through

// scripts/run-eval.ts (gate)
const base = await runMode("preload"); const nav = await runMode("indexed");
if (nav.accuracy < base.accuracy || nav.meanInputTokens >= base.meanInputTokens) process.exit(1);
```

## 8. Incremental Task Breakdown

| ID | Chunk | Files | Grounding | Acceptance criteria |
|----|-------|-------|-----------|---------------------|
| C1 | Add `governanceCoreSection` + join-skeleton renderer; unit-test byte-stability | `packages/agent/src/prompt.ts`, `packages/agent/test/prompt.test.ts` | REQ-2 | New section renders catalog+joinskeleton+glossary, no measures/dims; snapshot stable across calls |
| C2 | Make navigation the only path in `buildSystemPrompt` (drop `mode` param + preload branch); update snapshots | `packages/agent/src/prompt.ts`, `packages/agent/test/__snapshots__/prompt.test.ts.snap` | REQ-1, REQ-3 | `buildSystemPrompt` has no `mode` param; output = core + nav rule; `pnpm --filter @arivie/agent test` green |
| C3 | Remove `mode` from plugin (config + `resolveContextMode` + throw) | `packages/plugin-analytics/src/analytics.ts`, `packages/plugin-analytics/test/*` | REQ-1 | No `mode` in `AnalyticsPluginConfig`; no throw; plugin tests green; typecheck green |
| C4 | Relocate temporal grounding to per-request (after breakpoint) | `packages/agent/src/prompt.ts`, `packages/core/src/runtime/mastra-executor.ts` | REQ-4 | `temporalSection` not in system prompt; current time delivered per-request; existing temporal-resolution test still green |
| C5 | Wire Anthropic cache breakpoint on the governance core | `packages/core/src/define-app.ts`, `packages/core/src/runtime/mastra-executor.ts` | REQ-2 | `cacheControl: ephemeral` set on last core block via providerOptions; non-Anthropic path no-ops without error |
| C6 | `type` discriminator + `playbook`/`reference` in context loader | `packages/context/src/index.ts`, `packages/context/src/load.ts`, `packages/context/test/*` | REQ-5 | `ContextDocument.type` populated; unknown type → warning not error; tests cover playbook/reference/unknown |
| C7 | `index.md` catalog (consume if present, else synthesize) | `packages/context/src/load.ts`, `packages/context/src/index.ts` | REQ-6 | `ContextLayer.index()` returns catalog; missing `index.md` synthesizes from concepts; test both |
| C8 | `semantic:` cross-link refs + orphan validation | `packages/context/src/validate.ts`, `packages/context/test/*` | REQ-7 | `semantic:<entity>[.<measure>]` resolves against layer; unresolved → warning; test resolved + orphan |
| C9 | Eval gate: run preload vs indexed, assert accuracy + tokens | `scripts/run-eval.ts`, `scripts/eval-adapters.ts` | REQ-8 | Runs both modes; exits 1 on accuracy regression or non-lower tokens; prints comparison table |
| C10 | Author `with-pos-fnb` knowledge concepts (playbook+reference+index+xlink) | `examples/with-pos-fnb/knowledge/**` | REQ-5,6,7 | ≥1 `playbook` + ≥1 `reference` concept, an `index.md`, ≥1 `semantic:` xlink; loads with zero errors |
| C11 | Delete ADR-0004 residue: phantom deploy filter + frozen stub test | `package.json`, `packages/cli/test/deploy.test.ts` | ADR 0004 | Build script has no `@arivie/deploy` filter; stub test removed; `pnpm -r test` green |
| C12 | Changeset + docs: 3.0.0 breaking note; README knowledge-layer section | `.changeset/*`, `README.md`, `docs/` | REQ-1 | Changeset documents the `mode` removal + navigation default; README documents OKF concepts |

- [ ] **C1** core renderer → [ ] **C2** nav-only prompt → [ ] **C3** plugin flip → [ ] **C4** temporal → [ ] **C5** cache → [ ] **C6** type → [ ] **C7** index → [ ] **C8** xlink → [ ] **C9** gate → [ ] **C10** example → [ ] **C11** residue → [ ] **C12** docs

## 9. Validation and Testing

### 9.0 Validation Contract (assertion IDs)

| ID | Source | Assertion |
|----|--------|-----------|
| REQ-1 | §3 | No `mode` in plugin config/path; navigation is the only delivery model |
| REQ-2/4 | §3 | Governance core is byte-stable; no per-request value (incl. timestamp) in it |
| REQ-3 | §3 | Entity detail fetched via Workspace tools, not in system prompt |
| REQ-5/6/7 | §3 | `type`, `index.md`, and `semantic:` refs load and validate |
| test:prompt-core | §9.1 | governanceCoreSection snapshot + stability test green |
| test:context-type | §9.1 | type/playbook/reference/unknown loader tests green |
| cmd:eval-gate | §9.3 | `pnpm eval` exits 0 with nav ≥ preload accuracy and lower tokens |

### 9.1 Fail-to-Pass Tests
- `governanceCoreSection renders catalog+glossary without measures` (new, `agent`)
- `buildSystemPrompt has no mode branch` (update existing snapshot, `agent`)
- `context loader populates type and tolerates unknown` (new, `context`)
- `semantic: refs resolve and orphans warn` (new, `context`)

### 9.2 Regression Tests (Pass-to-Pass)
- `pnpm -r test` (all package suites), `pnpm typecheck`, the temporal-grounding resolution test.

### 9.3 Validation Commands
```bash
pnpm --filter @arivie/agent test
pnpm --filter @arivie/context test
pnpm --filter @arivie/plugin-analytics test
pnpm typecheck
pnpm eval            # the gate (C9): preload vs indexed, asserts accuracy + tokens
```

## 10. Security Considerations
No new attack surface. SQL safety is unchanged (read-only role + SELECT-only guard remain). The executable semantic layer stays typed/compilable — knowledge concepts are prose and never become SQL. Cross-link refs are validated against the loaded layer (no dynamic eval).

## 11. Rollback and Abort Criteria
- **Abort if** the eval gate (C9) cannot reach nav accuracy ≥ preload baseline after reasonable iteration — this is the load-bearing premise of ADR 0006; stop and re-evaluate the retrieval/governance-core split rather than shipping a regression. Treat a forced "make the gate pass by weakening assertions" as a symptom-patch — forbidden.
- **Rollback procedure:** the change is a major version; revert the chunks as a unit (they are sequenced, each independently committed). Preload code is deleted, not feature-flagged (zero-tech-debt) — rollback = git revert of the merge, not a runtime toggle.

## 12. Open Questions

- Q1: Detail-tier transport — Mastra Workspace navigation tools (already wired by `WORKSPACE_NAVIGATION_RULE`) vs a dedicated `read_entity` analytics tool. tradeoff: reuse/zero-new-surface vs ergonomics + token-projection control. **Proposal:** ship on Workspace tools (REQ-9, ADR 0002 reuse); revisit a dedicated tool only if the eval gate shows the agent mis-navigating.
- Q2: Retrieval for knowledge concepts — `index.md` + agent navigation now, vs hybrid (BM25+vector+RRF, ktx-style) immediately. tradeoff: lean first increment vs best relevance. **Proposal:** `index.md` + navigation first (REQ-6); hybrid retrieval is a deferred fast-follow (out of scope here, named in ADR 0006).
- Q3: Cache TTL — 5-minute ephemeral vs 1-hour. tradeoff: write cost vs idle survival. **Proposal:** 5-minute ephemeral default (matches interactive chat traffic); revisit per measured traffic shape.
