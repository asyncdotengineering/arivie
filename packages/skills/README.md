# @arivie/skills

Reusable analytical playbooks for the Arivie agent, packaged per the [Agent Skills spec](https://github.com/mastra-ai/skills) (Mastra Workspaces, Feb 2026).

## What's a skill?

A `SKILL.md` file with YAML frontmatter (`name`, `description`, `when_to_use`, optional `inputs[]`, `outputs[]`, `sources[]`) plus a markdown body teaching the agent a multi-step analytical workflow. Mastra's Workspace `skills` resolver discovers them at boot; the agent loads them on demand via auto-injected skill tools.

## Why externalise these?

Today, Arivie's hard-coded prompt rules (`REASONING_DISCIPLINE`, `JOIN_DISCIPLINE`, `OUTPUT_FORMAT_RULE`, …) are framework-level. A skill is **versionable, installable, swappable** — same author surface as shadcn-style UI components in `@arivie/registry`. Adding a new analytical pattern doesn't require an Arivie release.

## The six v0.2 skills

### `cohort-analysis`

Load when the user asks about retention, cohorts, signup-period comparisons, drop-off over time, or whether the retention curve is flattening. Skip for single-period active-user counts or single-user lookups — use `compile_metric` or `execute` instead.

### `funnel-conversion`

Load when the user asks about funnels, conversion rates, drop-off between steps, abandonment between events, or checkout completion. Skip for single-step counts or bare time-series of one funnel rate without a multi-step workflow.

### `churn-investigation`

Load when the user asks why customers stopped, churn diagnostics, or what differs between churned and retained cohorts. Skip for simple churn counts (`compile_metric` with a `churned` measure) or forward predictive scoring.

### `revenue-attribution`

Load when the user asks what drove revenue, attribution by channel/campaign/signup source, or which marketing brought the best customers. Skip for pure revenue totals without an attribution dimension or predictive marketing-mix modeling.

### `anomaly-detection`

Load when the user asks about anomalies, outliers, unusual spikes or drops, or unexpected changes in a metric. Skip for single-period values without a comparison baseline or forward-looking predictions.

### `dau-mau-ratio`

Load when the user asks about DAU/MAU/WAU, stickiness, engagement ratio, or whether the product is transactional vs sticky. Skip for raw DAU/MAU counts without the ratio, or cohort-by-cohort engagement (use `cohort-analysis`).

## Adding a skill

```text
packages/skills/<my-skill>/
├── SKILL.md              ← required (frontmatter + playbook)
└── references/           ← optional sub-docs, sample SQL, fixtures
    └── ...
```

`SKILL.md` frontmatter shape:

```yaml
---
name: my-skill
description: <one-line summary the agent uses to decide whether to load>
when_to_use: |
  Multi-line guidance on which question shapes trigger this skill.
inputs:
  - { name: foo, type: string, description: "..." }
outputs:
  - { name: result, type: object, description: "..." }
sources:                    # optional — which Arivie adapters this skill touches
  - postgres
  - mixpanel
---

# Skill body — the playbook

## Plan
1. ...
```

Arivie's system prompt advertises the skill's `name` + `description` + `when_to_use` to the agent. The agent calls a skill-loader tool that returns the full `SKILL.md` body, then follows the playbook.

## v0.3+ ideas

- Per-skill golden-SQL eval probes — `evals/skill-cohort-analysis.yml` etc. Locks the playbook against drift.
- Skill marketplace via `@arivie/registry`-style shadcn fetch (clone via the CLI: `arivie add skill cohort-analysis`).
- Cross-source skills (`funnel-conversion` joining Postgres user table + Mixpanel events).
