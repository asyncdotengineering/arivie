# @arivie/cli

Citty-based CLI for Arivie — `init`, `setup`, `add`, `lint`, `eval`, `dev`, `deploy`. Ships with **8 UI scaffolds** and **6 SOP skill playbooks** bundled in the tarball, so `arivie add` works offline immediately after install.

## Install

```bash
pnpm add -D @arivie/cli
```

Or use one-off via `pnpm dlx @arivie/cli <command>` — no install required.

## From zero to your first skill (60 seconds)

```bash
# 1. New project
mkdir my-arivie-app && cd my-arivie-app
pnpm init

# 2. Install Arivie packages
pnpm add @arivie/core @arivie/db-postgres @arivie/workspace @ai-sdk/google
pnpm add -D @arivie/cli

# 3. Drop in two SOP skill playbooks (no install of @arivie/skills required — they're bundled into the CLI)
pnpm dlx @arivie/cli add skill cohort-analysis
pnpm dlx @arivie/cli add skill funnel-conversion

ls skills/
# cohort-analysis/  funnel-conversion/

cat skills/cohort-analysis/SKILL.md | head -10
# ---
# name: cohort-analysis
# description: Compute cohort retention curves...
```

Six skills ship in the v0.1.1 CLI tarball:

| Skill | When to load |
|---|---|
| `cohort-analysis` | Retention curves; signup-period cohorts; drop-off over time |
| `funnel-conversion` | Step-wise conversion; where users drop in a funnel |
| `revenue-attribution` | Revenue split by acquisition channel / signup source |
| `dau-mau-ratio` | Stickiness; DAU/MAU/WAU; active-user definitions |
| `churn-investigation` | Why users churned; lapse triage |
| `anomaly-detection` | "Why did X spike?" / "Why did Y drop?" investigation |

For UI components (require `shadcn` first):

```bash
pnpm dlx shadcn@latest init  # one-time
pnpm dlx @arivie/cli add ui agent-chat
pnpm dlx @arivie/cli add ui sql-inspector
```

Eight scaffolds ship: `agent-chat`, `sql-inspector`, `semantic-browser`, `memory-editor`, `run-timeline`, `owner-context-badge`, `eval-diff`, `workflow-list`.

## Full command surface

```bash
# Non-interactive scaffold (CI-friendly)
arivie init --yes --name=my-app

# Interactive wizard
arivie init

# Idempotent DB + Mastra setup
arivie setup

# Introspect Postgres → semantic entity YAML
arivie add entity orders

# Copy a UI scaffold into ./components/arivie/ (requires shadcn)
arivie add ui agent-chat

# Copy a SOP skill playbook into ./skills/<name>/
arivie add skill cohort-analysis

# Lint semantic layer and emit .generated/index.ts
arivie lint

# Dogfood golden-SQL eval (monorepo; --mode closes B-KI-2-03)
arivie eval --mode preload

# Mastra dev server + panel URLs
arivie dev

# Deploy recipes
arivie deploy cloudflare-do
```

## How `arivie add` finds templates

The CLI resolves UI scaffolds and skills through a tier chain:

| Tier | Location | When it fires |
|---|---|---|
| 0 (dev) | `<monorepo>/packages/{registry,skills}/<name>/` | Hacking on arivie itself |
| 1 (bundled) | `<cli_install>/dist/templates/{registry,skills}/<name>/` | **The default for everyone else** — works offline, ships in the CLI tarball |
| 2 (npm) | `<cwd>/node_modules/@arivie/skills/<name>/` | Forward-compat if `@arivie/skills` ever ships to npm; currently unused |

You don't need to think about tiers — `arivie add` just works.

## Configuration

`setup`, `add entity`, `lint`, and `eval` load `arivie.config.ts` (default or named `config` export, or `defineArivie` instance + `DATABASE_URL`).

`eval` runs the dogfood suite (12 probes, testcontainers Postgres). `--mode` defaults from `config.semantic.mode` (with auto-detect). `rag` mode may pass fewer probes without pgvector/Docker embeddings infrastructure.

`dev` requires the `mastra` CLI (`pnpm i -D mastra`).

## API

```ts
import { runCli } from "@arivie/cli";
const exitCode = await runCli(process.argv.slice(2));
```

## License

Apache-2.0
