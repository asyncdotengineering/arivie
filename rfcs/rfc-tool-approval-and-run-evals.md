# RFC: Tool approval / HITL gate and Mastra `runEvals` migration

**Category:** New Feature
**Author:** opencode
**Date:** 2026-06-20
**Status:** Draft
**Reviewers:** (self-driven, approved by user inline)
**Related:**
- `packages/core/src/define.ts` — `defineArivie`, `ask`, schedule workflows
- `packages/core/src/config.ts` — `ArivieConfigSchema`
- `packages/core/src/types.ts` — `ArivieConfig`, `LimitConfig`
- `packages/agent/src/make-agent.ts` — agent construction, `defaultOptions`
- `packages/core/src/eval/sql-semantic-scorer.ts` — existing Mastra scorer
- `scripts/run-eval.ts` — dogfood eval runner to migrate
- Mastra 1.45 `AgentExecutionOptions.requireToolApproval` (`packages/core/dist/agent/agent.types.d.ts:502`)
- Mastra 1.45 `createTool({ requireApproval })` and `NeedsApprovalFn` (`packages/core/dist/tools/types.d.ts`)
- Mastra 1.45 `runEvals` (`packages/core/dist/evals/run/index.d.ts`)

---

## 1. Problem Statement

Arivie currently lets the agent execute arbitrary SQL and workspace tools with no human gate. Two gaps need to close in this cut:

1. **Tool approval / human-in-the-loop (HITL):** Operators need to require explicit approval before selected tools run, especially destructive or high-blast-radius tools (`workspace_bash`, `mastra_workspace_write_file`, MCP mutations, raw `execute_<source>`). Mastra 1.45 exposes `requireToolApproval` on `agent.generate`/`agent.stream` and per-tool `requireApproval`; Arivie does not surface either.

2. **Eval harness on Mastra primitives:** `scripts/run-eval.ts` rolls its own probe loop, result-set comparison, and validation rules. We already built a Mastra `createScorer`-based SQL-semantic scorer in `@arivie/core/eval`; the runner should use Mastra `runEvals` with that scorer plus rule-based scorers, removing duplicated extraction/comparison code.

Success means:
- Arivie config accepts an approval policy and every `agent.generate` path (`ask`, schedules, direct `.agent.generate`) honors it.
- `pnpm eval` (and its mock/live modes) runs through `runEvals` from `@mastra/core/evals` and produces the same pass/fail summary with the same 9/12 threshold.
- Typecheck, build, and test suites remain green.

## 2. Background

Arivie is a single-agent analytics surface. `defineArivie` builds a Mastra `Agent` via `makeAgent` (`packages/agent/src/make-agent.ts:265`), registers `execute_<source>` / `compile_metric` / `finalize_report` / optional `workspace_bash`, and exposes `ArivieInstance.ask` (`packages/core/src/define.ts:349`) and schedule workflows (`packages/core/src/define.ts:263`). All agent invocation currently passes only `memory` and `defaultOptions` (`stopWhen` or `maxSteps`); no approval gate is configured.

Mastra 1.45 added:
- `requireToolApproval?: RequireToolApproval` on `AgentExecutionOptions` (`packages/core/dist/agent/agent.types.d.ts:502`). `RequireToolApproval` is `boolean | ({ toolName, args, requestContext }) => boolean | Promise<boolean>`.
- Per-tool `requireApproval?: boolean | NeedsApprovalFn` on `createTool` / `Tool` (`packages/core/dist/tools/types.d.ts`).
- `runEvals` in `@mastra/core/evals` (`packages/core/dist/evals/run/index.d.ts:39`) that runs a target `Agent` or `Workflow` against a dataset and a set of `MastraScorer`s.

The existing `@arivie/core/eval` scorer (`packages/core/src/eval/sql-semantic-scorer.ts:134`) already conforms to `MastraScorer` via `createScorer`. It expects `run.groundTruth` as the golden SQL and executes/comparse result sets.

`scripts/run-eval.ts` currently:
- Loads 12 YAML probes from `evals/golden-queries/*.yml`.
- Spins up a testcontainers Postgres, seeds it, and builds an Arivie instance.
- Calls `instance.agent.generate(...)` directly for each probe inside `runWithUserContext`.
- Extracts SQL via `extractExecuteSql`, compares results via `resultsEqual`, and runs validation rules inline (`runValidationRules`, `run-eval.ts:220`).
- Prints per-probe results and a 9/12 threshold summary.

This runner mixes infrastructure setup, probe execution, scoring, and reporting. The migration will keep the infrastructure setup but delegate probe execution + scoring to Mastra `runEvals`.

## 3. Strict Requirements

- REQ-1: `ArivieConfig` accepts an optional approval policy. The policy must support at least:
  - `false` / `undefined` — no gate (default).
  - `true` — every tool call requires approval.
  - `{ tools: string[] }` — only listed tools require approval (allowlist).
  - `{ exceptTools: string[] }` — all tools except listed require approval (denylist).
  - A function `(toolName, args, requestContext) => boolean | Promise<boolean>` — custom logic.
- REQ-2: The approval policy is applied to every agent execution path Arivie controls:
  - `ArivieInstance.ask`.
  - Scheduled workflow steps.
  - The agent's `defaultOptions` so direct `instance.agent.generate(...)` callers inherit it unless they override.
- REQ-3: Per-tool `requireApproval` can still be set by tool authors; the global policy must compose predictably with per-tool flags. Decision: per-tool `requireApproval: true` always forces approval regardless of global policy; per-tool `requireApproval: false` exempts that tool from the global policy; global policy only affects tools that do not explicitly opt out.
- REQ-4: The approval gate uses Mastra's native suspension primitive (`requireToolApproval`). Arivie does not implement a custom resume channel; callers resume through Mastra's documented APIs (`agent.resume`, `respondToToolApproval`, etc.) using the exposed `ArivieInstance.agent`.
- REQ-5: `scripts/run-eval.ts` is refactored to run probes through `runEvals` from `@mastra/core/evals`.
- REQ-6: The SQL-semantic scorer is reused from `@arivie/core/eval`.
- REQ-7: YAML validation rules are converted to Mastra scorers so `runEvals` produces a single score per rule per probe.
- REQ-8: The migrated runner preserves the existing CLI contract (`--mode preload|browse|rag`), the mock/live model resolution, the 9/12 threshold, and the artifact write path.
- REQ-9: Deprecated eval modes `"browse"` and `"rag"` are mapped to the current Arivie semantic modes (`"preload"` and `"indexed"`) with a deprecation warning.
- REQ-10: Every new/changed file has tests; the full matrix (`typecheck`, `build`, `test`) stays green.

## 4. Interface Specification

### 4.1 Approval policy types

- **Location:** `packages/core/src/types.ts`
- **Signature:**
  ```ts
  export type ToolApprovalPolicy =
    | boolean
    | { tools: string[] }
    | { exceptTools: string[] }
    | ((toolName: string, args: Record<string, unknown>, requestContext?: unknown) => boolean | Promise<boolean>);
  ```
- **Behavior:** Describes which tool calls require human approval.
- **Error cases:** Invalid shapes rejected by `ArivieConfigSchema`.

### 4.2 `LimitConfig` extension

- **Location:** `packages/core/src/types.ts`, `packages/core/src/config.ts`
- **Signature:** add `requireToolApproval?: ToolApprovalPolicy` to `LimitConfig`.
- **Behavior:** Groups the gate with other runtime limits. `ArivieConfig.limits` already threads through `makeAgent`.

### 4.3 `makeAgent` option

- **Location:** `packages/agent/src/make-agent.ts`
- **Signature:** add `requireToolApproval?: ToolApprovalPolicy` to `MakeAgentOptions`.
- **Behavior:** Translates the policy into Mastra's `RequireToolApproval` form and sets it on `agentConfig.defaultOptions.requireToolApproval`.

### 4.4 `ask` and schedule pass-through

- **Location:** `packages/core/src/define.ts`
- **Signature:** no public signature change; `ask` and schedule workflow steps pass the agent's `defaultOptions` implicitly by calling `agent.generate(...)` without overriding `requireToolApproval`.
- **Behavior:** Callers of `ask` cannot override approval per call in v1; direct `.agent.generate(...)` callers can.

### 4.5 Validation-rule scorers

- **Location:** `packages/core/src/eval/validation-scorers.ts`
- **Signature:**
  ```ts
  export type ValidationRule =
    | { result_has_rows: boolean }
    | { column_exists: string }
    | { value_positive: string }
    | { max_rows: number }
    | { assumption_states: string[] }
    | { tool_calls_min: number }
    | { answer_must_not_claim_zero_revenue: boolean };

  export function createValidationScorers(rules: ValidationRule[]): MastraScorer<any, any, any, any>[];
  ```
- **Behavior:** Returns one scorer per rule. Each scorer receives the agent output, extracts rows/tool calls/text via shared helpers, and returns 1 (pass) or 0 (fail) with a reason.

### 4.6 `runEvals` runner

- **Location:** `scripts/run-eval.ts`
- **Signature:**
  ```ts
  export type EvalMode = "preload" | "indexed";
  export interface RunDogfoodEvalResult { /* unchanged */ }
  export async function runDogfoodEval(options: { mode: EvalMode }): Promise<RunDogfoodEvalResult>;
  ```
- **Behavior:** Sets up the test DB and Arivie instance, builds `runEvals` data items + scorers, calls `runEvals`, then prints the same summary as today.

## 5. Architecture and System Dependencies

### 5.1 Structural Changes

```
packages/core/src/types.ts
  +- add ToolApprovalPolicy, extend LimitConfig
packages/core/src/config.ts
  +- update limitSchema / ArivieConfigSchema for ToolApprovalPolicy
packages/agent/src/make-agent.ts
  +- accept requireToolApproval, translate to Mastra RequireToolApproval, set defaultOptions
packages/core/src/eval/validation-scorers.ts  (new)
  +- createValidationScorers + per-rule scorer factories
packages/core/src/eval/index.ts
  +- export createValidationScorers + ValidationRule
scripts/run-eval.ts
  +- replace custom probe loop with runEvals
  +- map "browse"/"rag" -> "preload"/"indexed"
  +- build scorers from probe.validation + golden SQL
packages/core/test/tool-approval.test.ts  (new)
packages/core/test/validation-scorers.test.ts  (new)
```

### 5.2 Service and Library Dependencies

- `@mastra/core/evals` for `runEvals` and `createScorer`.
- `@mastra/core/tools` types for `NeedsApprovalFn`, `RequireToolApproval`.
- Existing `@arivie/db-postgres`, `@testcontainers/postgresql`, `yaml`.

### 5.3 Data and Schema Changes

- No DB migrations.
- `ArivieConfigSchema` gains an optional `limits.requireToolApproval` field.
- YAML probe schema unchanged.

### 5.4 Network and Performance Considerations

- Approval gates serialize tool calls when a function policy is used (Mastra behavior). Expected for HITL.
- `runEvals` with `concurrency` defaults to sequential or limited parallel; keep `concurrency: 1` to preserve the current per-probe log order and avoid DB connection contention in the single testcontainer.

## 6. Pseudocode

### 6.1 Policy normalization

```
FUNCTION normalizeRequireToolApproval(policy):
    IF policy is undefined OR policy is false:
        RETURN undefined  // no gate
    IF policy is true:
        RETURN true
    IF policy has .tools array:
        RETURN (toolName) => policy.tools.includes(toolName)
    IF policy has .exceptTools array:
        RETURN (toolName) => !policy.exceptTools.includes(toolName)
    IF policy is function:
        RETURN policy
    THROW invalid policy
```

### 6.2 `makeAgent` defaultOptions

```
agentConfig.defaultOptions = {
    ...existing stopWhen/maxSteps,
    ...(requireToolApproval !== undefined ? { requireToolApproval } : {})
}
```

### 6.3 Validation scorers

```
FUNCTION createValidationScorers(rules):
    scorers = []
    FOR rule IN rules:
        scorer = scorerForRule(rule)
        scorers.push(scorer)
    RETURN scorers

FUNCTION scorerForRule(rule):
    RETURN createScorer({ id: ruleId(rule), description: ... }).generateScore(async ({ run }) => {
        output = run.output
        rows = extractRows(output)
        text = output.text
        toolCalls = countExecuteCalls(output.toolResults, output.steps)
        RETURN evaluate(rule, rows, text, toolCalls) ? 1 : 0
    })
```

### 6.4 `runEvals` runner

```
FUNCTION runDogfoodEval({ mode }):
    container = startPostgres()
    setupDb(container)
    instance = defineArivie(...)
    storage.init()
    warmup(instance)
    probes = loadProbes()

    data = probes.map(probe => ({
        input: probe.question,
        groundTruth: probe.golden_sql,
        metadata: { probeId: probe.id, category: probe.category, validation: probe.validation }
    }))

    executeSql = (sql) => readerDb.execute(sql).rows
    scorers = [
        createSqlSemanticScorer({ executeSql }),
        ...probes.flatMap(p => createValidationScorers(p.validation))  // WRONG — per-probe scorers can't be global
    ]

    // Correct approach: one composite scorer that reads per-item metadata.
    compositeScorer = createCompositeScorer({ executeSql })

    result = await runEvals({ data, target: instance.agent, scorers: [compositeScorer], concurrency: 1 })
    summary = summarize(result, probes)
    printAndWriteArtifact(summary)
    RETURN summary
```

The composite scorer inspects `run.metadata.validation` and `run.metadata.category` to apply probe-specific rules and SQL comparison.

## 7. Code Blueprint

### 7.1 `packages/core/src/types.ts`

```ts
export type ToolApprovalPolicy =
  | boolean
  | { tools: string[] }
  | { exceptTools: string[] }
  | ((
      toolName: string,
      args: Record<string, unknown>,
      requestContext?: unknown,
    ) => boolean | Promise<boolean>);

export interface LimitConfig {
  rowsPerQuery?: number;
  queryTimeoutMs?: number;
  tokensPerRequest?: number;
  tokensPerUserPerMonth?: number | null;
  maxSteps?: number;
  /** Require human approval before selected tool calls run. */
  requireToolApproval?: ToolApprovalPolicy;
}
```

### 7.2 `packages/core/src/config.ts`

```ts
const toolApprovalPolicySchema: z.ZodType<ToolApprovalPolicy> = z.union([
  z.boolean(),
  z.object({ tools: z.array(z.string().min(1)) }).strict(),
  z.object({ exceptTools: z.array(z.string().min(1)) }).strict(),
  z.custom<ToolApprovalPolicy["function"]>((v) => typeof v === "function"),
]);

const limitSchema = z
  .object({
    rowsPerQuery: z.number().optional(),
    queryTimeoutMs: z.number().optional(),
    tokensPerRequest: z.number().optional(),
    tokensPerUserPerMonth: z.number().nullable().optional(),
    maxSteps: z.number().optional(),
    requireToolApproval: toolApprovalPolicySchema.optional(),
  })
  .strict();
```

### 7.3 `packages/agent/src/make-agent.ts`

```ts
export interface MakeAgentOptions {
  // ... existing fields ...
  requireToolApproval?: ToolApprovalPolicy;
}

function normalizeRequireToolApproval(
  policy: ToolApprovalPolicy | undefined,
): RequireToolApproval | undefined {
  if (policy == null || policy === false) return undefined;
  if (policy === true) return true;
  if ("tools" in policy) {
    return ({ toolName }) => policy.tools.includes(toolName);
  }
  if ("exceptTools" in policy) {
    return ({ toolName }) => !policy.exceptTools.includes(toolName);
  }
  return policy;
}

export function makeAgent(opts: MakeAgentOptions): Agent {
  // ...
  const requireToolApproval = normalizeRequireToolApproval(
    opts.requireToolApproval,
  );

  agentConfig.defaultOptions = {
    ...(registerFinalizeReport
      ? { stopWhen: finalizeReportStopWhen }
      : { maxSteps }),
    ...(requireToolApproval !== undefined
      ? { requireToolApproval }
      : {}),
  };
  // ...
}
```

### 7.4 `packages/core/src/define.ts`

`makeAgent` call receives `limits: parsed.limits` which now includes `requireToolApproval`. No other change needed because `agent.generate` inherits `defaultOptions`.

### 7.5 `packages/core/src/eval/validation-scorers.ts`

```ts
import { createScorer } from "@mastra/core/evals";
import { extractExecuteSql } from "./sql-semantic-scorer.js";

export type ValidationRule = /* same as run-eval.ts today */;

function countExecuteCalls(toolResults: unknown, steps?: unknown): number { /* move from run-eval.ts */ }
function answerClaimsZeroRevenue(text: string): boolean { /* move from run-eval.ts */ }

export function createValidationScorers(rules: ValidationRule[]) {
  return rules.map((rule, idx) => createScorer({
    id: `validation-${ruleName(rule)}-${idx}`,
    description: describeRule(rule),
    type: "agent",
  }).generateScore(async ({ run }) => {
    const output = run.output as Record<string, unknown> | undefined;
    const text = typeof output?.text === "string" ? output.text : "";
    const toolResults = output?.toolResults;
    const steps = output?.steps;
    const toolCallCount = countExecuteCalls(toolResults, steps);
    const agentSql = extractExecuteSql(toolResults, steps);
    let rows: Record<string, unknown>[] = [];
    if (agentSql != null) {
      const executeSql = run.additionalContext?.executeSql as (sql: string) => Promise<Record<string, unknown>[]>];
      rows = await executeSql(agentSql);
    }
    return evaluateRule(rule, { rows, text, toolCallCount }) ? 1 : 0;
  }));
}
```

Note: `runEvals` passes `additionalContext` from the data item. The runner will put `executeSql` there.

### 7.6 Composite eval scorer

Because SQL semantic comparison needs `executeSql` and per-probe validation rules, and `runEvals` applies the same scorers to every item, we use a single composite scorer that reads `run.metadata`:

```ts
export function createDogfoodScorer(opts: {
  executeSql: (sql: string) => Promise<Record<string, unknown>[]>;
}) {
  return createScorer({
    id: "dogfood-composite",
    description: "SQL semantic equivalence + probe-specific validation rules",
    type: "agent",
  }).generateScore(async ({ run }) => {
    const metadata = run.metadata as ProbeMetadata | undefined;
    const output = run.output as Record<string, unknown> | undefined;
    const agentSql = extractExecuteSql(output?.toolResults, output?.steps);
    const failures: string[] = [];

    if (agentSql == null) failures.push("no execute SQL");

    const goldenSql = typeof run.groundTruth === "string" ? run.groundTruth : "";
    if (!goldenSql) failures.push("missing golden SQL");

    if (failures.length === 0) {
      const [goldenRows, agentRows] = await Promise.all([
        opts.executeSql(goldenSql),
        opts.executeSql(agentSql),
      ]);
      const compareResults = metadata?.category === "normal" || metadata?.category === "ambiguous";
      if (compareResults && !resultsEqual(agentRows, goldenRows)) {
        failures.push("results differ from golden SQL");
      }
      const text = typeof output?.text === "string" ? output.text : "";
      const toolCallCount = countExecuteCalls(output?.toolResults, output?.steps);
      failures.push(...runValidationRules(metadata?.validation ?? [], { rows: agentRows, text, toolCallCount }));
    }

    return failures.length === 0 ? 1 : 0;
  });
}
```

### 7.7 `scripts/run-eval.ts`

```ts
import { runEvals } from "@mastra/core/evals";
import { createDogfoodScorer } from "@arivie/core/eval";

const data = probes.map((probe) => ({
  input: probe.question,
  groundTruth: probe.golden_sql,
  metadata: {
    probeId: probe.id,
    category: probe.category,
    validation: probe.validation,
  },
  additionalContext: { executeSql },
}));

const scorer = createDogfoodScorer({ executeSql });

const evalResult = await runEvals({
  data,
  scorers: [scorer],
  target: instance.agent,
  targetOptions: {
    memory: { thread: "eval-run", resource: "eval-user" },
  },
  concurrency: 1,
  onItemComplete: ({ item, targetResult, scorerResults }) => {
    // print per-probe results exactly as today
  },
});

// Derive passed/total from scorerResults["dogfood-composite"].score
```

## 8. Incremental Task Breakdown

| ID | Chunk | Files | Grounding (REQ/test) | Acceptance criteria |
|----|-------|-------|----------------------|---------------------|
| C1 | Add `ToolApprovalPolicy` type and extend `LimitConfig` | `packages/core/src/types.ts` | REQ-1 | `ToolApprovalPolicy` exported; `LimitConfig` includes it; typecheck green |
| C2 | Schema validation for approval policy | `packages/core/src/config.ts` | REQ-1 | `ArivieConfigSchema` accepts bool/allowlist/denylist/function and rejects invalid shapes; test added |
| C3 | Normalize and apply policy in `makeAgent` | `packages/agent/src/make-agent.ts` | REQ-2, REQ-3 | `defaultOptions.requireToolApproval` set from policy; function policies normalized |
| C4 | Thread policy through `defineArivie` | `packages/core/src/define.ts` | REQ-2 | `makeAgent` receives `requireToolApproval` from `parsed.limits`; no new type errors |
| C5 | Tool approval unit tests | `packages/core/test/tool-approval.test.ts` | REQ-2, REQ-3 | Tests prove allowlist/denylist/function gate the right tools; default no gate |
| C6 | Extract shared eval helpers | `packages/core/src/eval/helpers.ts`, `scripts/run-eval.ts` | REQ-5, REQ-6 | `countExecuteCalls`, `answerClaimsZeroRevenue`, `runValidationRules` move to `@arivie/core/eval` |
| C7 | Build composite dogfood scorer | `packages/core/src/eval/dogfood-scorer.ts` | REQ-6, REQ-7 | Scorer returns 1/0 combining SQL semantic equivalence + validation rules |
| C8 | Export composite scorer | `packages/core/src/eval/index.ts` | REQ-6 | `createDogfoodScorer` exported |
| C9 | Migrate runner to `runEvals` | `scripts/run-eval.ts` | REQ-5, REQ-8, REQ-9 | Uses `runEvals`; maps deprecated modes; preserves CLI/summary/artifact |
| C10 | Eval scorer tests | `packages/core/test/dogfood-scorer.test.ts` | REQ-7 | Unit tests for composite scorer on pass/fail probes |
| C11 | Integration smoke: mock eval | `scripts/run-eval.ts` | REQ-8, cmd:eval-mock | `pnpm eval` with mock model exits 0/1 correctly and writes artifact |
| C12 | Full matrix verification | monorepo | REQ-10 | `pnpm typecheck`, `pnpm build`, `pnpm test` green |

## 9. Validation and Testing

### 9.0 Validation Contract

| ID | Source | Assertion |
|----|--------|-----------|
| REQ-1 | §3 | Config accepts all policy shapes |
| REQ-2 | §3 | All agent invocations honor policy |
| REQ-3 | §3 | Per-tool flags override global policy |
| REQ-5 | §3 | Runner uses `runEvals` |
| REQ-6 | §3 | SQL scorer reused |
| REQ-7 | §3 | Validation rules are scorers |
| REQ-8 | §3 | CLI contract preserved |
| REQ-10 | §3 | Matrix green |
| test:tool-approval | §9.1 | Allowlist/denylist/function gate correctly |
| test:dogfood-scorer | §9.1 | Composite scorer passes golden, fails bad SQL, fails rule violations |
| cmd:eval-mock | §9.3 | `pnpm eval` with mock model runs end-to-end |
| cmd:typecheck | §9.3 | `pnpm typecheck` passes |
| cmd:build | §9.3 | `pnpm build` passes |
| cmd:test | §9.3 | `pnpm test` passes |

### 9.1 Fail-to-Pass Tests

- `packages/core/test/tool-approval.test.ts`
  - `allowlist gates only listed tools`
  - `denylist exempts only listed tools`
  - `function policy receives toolName and args`
  - `per-tool requireApproval:false exempts from global gate`
  - `default has no gate`
- `packages/core/test/dogfood-scorer.test.ts`
  - `passes when SQL matches golden and validation rules pass`
  - `fails when SQL result differs`
  - `fails when validation rule fails`
  - `zero-row category skips SQL comparison`

### 9.2 Regression Tests

- Existing `packages/core/test/sql-semantic-scorer.test.ts` must still pass.
- Existing schedule tests must still pass.
- Existing `pnpm test` suite must still pass.

### 9.3 Validation Commands

```bash
# Typecheck
pnpm typecheck

# Build
pnpm build

# Unit tests
pnpm test

# Mock eval end-to-end
pnpm eval

# Live eval (requires ANTHROPIC_API_KEY)
# ANTHROPIC_API_KEY=... pnpm eval
```

## 10. Security Considerations

- Tool approval is a gate, not a sandbox. It relies on the operator's decision at resume time.
- Function policies run with tool arguments; they must not mutate state or leak secrets.
- The composite scorer executes agent-generated SQL against the test DB; this is acceptable in the eval harness because the DB is a throwaway testcontainer and the role is `arivie_reader`.
- No new secrets or env vars.

## 11. Rollback and Abort Criteria

- Abort if Mastra's `requireToolApproval` API changes shape between 1.45 and the installed version and cannot be satisfied without casts.
- Abort if `runEvals` does not expose enough metadata/context to execute golden SQL per probe.
- Rollback if `pnpm eval` mock mode produces a different pass count than the baseline (12 probes, threshold 9/12) for reasons other than genuine scorer improvement.
- Rollback if any existing test suite regresses.

## 12. Open Questions

- Q1: Should `ArivieInstance.ask` accept a per-call `requireToolApproval` override?
  - Tradeoff: More flexibility vs. larger API surface and the need to thread options through `runWithUserContext`.
  - **Proposal:** No per-call override in this cut. Callers who need dynamic gates can call `instance.agent.generate(...)` directly with Mastra options. Revisit if product asks for it.

- Q2: Should validation rules remain scorable one-per-rule (multiple scorers) or collapsed into the single composite scorer?
  - Tradeoff: One scorer per rule gives granular `runEvals` output but requires passing `executeSql` to every scorer and increases scorer count. Composite scorer keeps the runner simple and matches today's single-pass/fail per probe.
  - **Proposal:** Use a single composite scorer for the dogfood runner. Individual rule scorers can be exposed from `@arivie/core/eval` later if needed.

- Q3: Where should the deprecation warning for `"browse"`/`"rag"` modes print?
  - Tradeoff: `run-eval.ts` is a script; warning on stderr keeps stdout artifact clean but may be missed. Warning on stdout pollutes the artifact.
  - **Proposal:** Print deprecation warning to `console.warn` (stderr) at runner start.
