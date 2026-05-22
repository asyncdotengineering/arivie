<div align="center">

<img src=".assets/logo.png" alt="Arivie chibi owl mascot" width="220" />

# Arivie

**The analytics agent you own.**

[![npm](https://img.shields.io/npm/v/%40arivie%2Fcore?label=%40arivie%2Fcore&color=0d9488)](https://www.npmjs.com/package/@arivie/core)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-0d9488.svg)](./LICENSE)
[![Status: alpha](https://img.shields.io/badge/status-alpha-fb923c)](#status)
[![Docs](https://img.shields.io/badge/docs-arivie--docs.vercel.app-2ecc71)](https://arivie-docs.vercel.app)
[![Straight out of the oven](https://img.shields.io/badge/🔥-straight%20out%20of%20the%20oven-fb923c)](#status)
[![Active development](https://img.shields.io/badge/active-development-2ecc71)](#status)
[![Node ≥20](https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![pnpm 10](https://img.shields.io/badge/pnpm-10-f69220?logo=pnpm&logoColor=white)](https://pnpm.io)
[![TypeScript 5.9](https://img.shields.io/badge/typescript-5.9-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Wraps Mastra 1.35](https://img.shields.io/badge/wraps-mastra%201.35-fb923c)](https://mastra.ai)

</div>

> **Arivie** (pronounced *"ah-REE-vee"*, rhymes with *trivia*) is a TypeScript-first, source-available, self-host-first framework for building **agentic analytics** on your warehouse. The Tamil root *arivu* (அறிவு — *knowledge / intelligence*) is hidden inside the spelling. Sibling-shaped with [Ahamie](https://github.com/asyncdotengineering/ahamie) and [Porulle](https://github.com/asyncdotengineering/porulle).

You install it the way you install Next.js, Drizzle, or Inngest:

```bash
pnpm dlx @arivie/cli init my-agent
```

Arivie wraps **Mastra** (`@mastra/core`, agent runtime, memory, workspace primitives, MCP) and contributes what an analytics-agent product actually needs that a generic agent framework deliberately omits:

- 🦉 **Single-agent shape** — text-to-SQL + workspace tools on one model. No supervisor, no sub-agents, no prose-handoff fabrication. (See [the single-agent shape](https://arivie-docs.vercel.app/concepts/the-single-agent/) for the prose-boundary failure mode we avoid.)
- 📚 **Semantic layer as contract** — YAML entities with measures, dimensions, segments, joins, hints. Compiles to canonical SQL via `compile_metric`. No reinvented metrics across turns.
- 📖 **Skills are SOPs** — versioned Markdown playbooks for recurring analyses (daily recap, prime cost, food cost variance). The agent reads the playbook before answering. New analysts get the senior analyst's answer because the skill IS the senior analyst.
- 🔌 **Multi-source + MCP at both ends** — Postgres + Mixpanel + any external MCP server (Linear, Slack, qmd, your own) as sources, AND `arivie mcp` exposes your agent to MCP-aware clients (Claude Desktop, Cursor, custom). The agent sits at both ends of the protocol.
- 🛡️ **Read-only by construction** — `arivie_reader` DB role, session-variable-scoped views, prompt-injection guards. Owner-identity boundary verified on every request.

Read [`./docs/`](./docs/) for the live site. Quickstart below gets you a streamed answer in under 10 minutes.

---

## Status

| | |
|---|---|
| Version | `0.3.0` — code-DX-clean shape, **straight out of the oven** |
| Repo | [github.com/asyncdotengineering/arivie](https://github.com/asyncdotengineering/arivie) |
| Docs | [arivie-docs.vercel.app](https://arivie-docs.vercel.app) |
| npm | [`@arivie/core`](https://www.npmjs.com/package/@arivie/core), [`@arivie/cli`](https://www.npmjs.com/package/@arivie/cli), [`@arivie/agent`](https://www.npmjs.com/package/@arivie/agent), [`@arivie/db-postgres`](https://www.npmjs.com/package/@arivie/db-postgres), [`@arivie/workspace`](https://www.npmjs.com/package/@arivie/workspace), [`@arivie/semantic`](https://www.npmjs.com/package/@arivie/semantic), and 7 more |
| Maturity | **alpha** — APIs may shift before v1; semver discipline applies |
| Cadence | **active development** — daily commits, weekly releases via changesets |
| Runtime | Node ≥20 LTS primary; Bun supported on `core/cli` |
| License | Apache-2.0 |
| Tested on | macOS · Linux · Postgres 14+ |
| Build | **13 packages** green via `pnpm build` |
| Tests | **505 passing** across 13 test suites |

---

## Quickstart

```bash
mkdir my-agent && cd my-agent
pnpm init
pnpm add @arivie/core @arivie/db-postgres @ai-sdk/openai
pnpm add -D @arivie/cli tsx

pnpm dlx @arivie/cli init   # scaffolds arivie.config.ts + semantic/ + skills/
pnpm dlx @arivie/cli setup  # creates arivie_reader DB role, runs Mastra Memory migrations
```

Then in `scripts/ask.ts`:

```ts
import { defineArivie, localWorkspace } from "@arivie/core";
import { postgresAdapter } from "@arivie/db-postgres";
import { openai } from "@ai-sdk/openai";

const instance = await defineArivie({
  owner: { id: "acme", name: "Acme" },
  model: openai("gpt-5-mini"),
  semantic: { path: "./semantic", mode: "preload" },
  skills: "./skills",
  sources: {
    postgres: postgresAdapter({ url: process.env.DATABASE_URL! }),
  },
  workspace: localWorkspace({ at: "./workspace", bash: true }),
  compileMetric: true,
  resolveUser: async () => ({
    userId: "you",
    permissions: ["analytics:read"],
    dbRole: "arivie_reader",
  }),
});

const result = await instance.ask({
  prompt: "What was last week's revenue per outlet? Write me a Markdown report.",
  user: { userId: "you", permissions: ["analytics:read"], dbRole: "arivie_reader" },
});

console.log(result.text);
console.log(result.toolCalls);  // typed tool-call trace
console.log(result.sql);         // SQL statements that ran
console.log(result.artifacts);   // files the agent wrote
```

That's everything. One agent, one turn, SQL + workspace tools attached. Zero `as any`.

---

## A 30-second tour of the surface

```ts
import { defineArivie, localWorkspace, mcpSource } from "@arivie/core";
import { postgresAdapter } from "@arivie/db-postgres";
import { defineEntity } from "@arivie/semantic";

// 1. Define an entity in TypeScript (or use YAML + `arivie types` codegen).
const orders = defineEntity({
  name: "orders",
  description: "Customer orders.",
  grain: "one row per order",
  primary_key: "id",
  measures: [
    { name: "revenue", description: "Total revenue", sql: "SUM(total_amount)" },
  ],
  dimensions: [
    { name: "status", sql: "status", values: ["pending", "completed", "refunded"] },
  ],
  segments: [
    { name: "current_quarter", sql: "created_at >= date_trunc('quarter', CURRENT_DATE)" },
  ],
});

// 2. Compose multi-source: SQL + MCP + workspace tools in one config.
const instance = await defineArivie({
  owner: { id: "acme", name: "Acme" },
  model: openai("gpt-5-mini"),
  semantic: { path: "./semantic", mode: "preload" },
  skills: "./skills",
  sources: {
    postgres: postgresAdapter({ url: process.env.DATABASE_URL! }),
    linear:   mcpSource({ command: "linear-mcp-server", env: { LINEAR_API_KEY: process.env.LINEAR_API_KEY! } }),
    docs:     mcpSource({ command: "qmd", args: ["mcp"] }),  // compose with any MCP-speaking tool
  },
  workspace: localWorkspace({ at: "./workspace", bash: true }),
  compileMetric: true,
  resolveUser: ({ req }) => myAuth.resolve(req),
});

// 3. Or expose Arivie AS an MCP server (Claude Desktop, Cursor, etc. can connect):
//    $ arivie mcp              # stdio
//    $ arivie mcp --http --port 8181
```

---

## What you get

**Single-agent runtime** — text-to-SQL grounded in the semantic layer, plus a sandboxed workspace (read/write/grep/edit + opt-in bash). The same agent that runs the SQL writes the report file. Rows stay in one scratchpad end-to-end.

**Semantic layer** — YAML or TypeScript-authored entities with measures, dimensions, segments, joins, hints, PII flags. `compile_metric` emits canonical SQL from declared measures.

**Skills (SOPs)** — `skills/<name>/SKILL.md` playbooks with `when_to_use` frontmatter. Auto-loaded eagerly (≤6 skills) or BM25-searched on-demand (>6). The agent consults the playbook before composing SQL — hard rule in the system prompt.

**Multi-source** — Postgres + Mixpanel + arbitrary MCP servers as sources. Each gets its own `execute_<name>` tool. Cross-source hash joins for cases where SQL can't bridge.

**MCP at both ends** — `mcpSource()` to consume; `arivie mcp` to expose. Compose Arivie with any MCP-speaking domain tool (qmd for docs, linear-mcp-server for tickets, etc.) without writing integration code.

**Workspace tools** — `mastra_workspace_{read_file, write_file, grep, list_files, edit_file, mkdir, delete, file_stat}` auto-attached via Mastra. `workspace_bash` opt-in for shell utilities (python, jq, awk).

**Hardened boundary** — `arivie_reader` DB role with `SELECT`-only grants, session-variable-scoped views with `tenant_id` hidden, prompt-injection guards, system-catalog blocks, row-limit + query timeout caps.

**Type-safe codegen** — `arivie types` reads your `semantic/entities/*.yml` + `skills/*/SKILL.md` and emits `.arivie/types.ts` with `EntityName | <Entity>Measure | <Entity>Dimension | <Entity>Segment | ArivieSemantic | SkillName` — Drizzle-style narrowing for the whole semantic layer.

**Typed `instance.ask()`** — strict `AskResult` with `text`, `toolCalls`, `sql`, `artifacts`. No `Record<string, unknown>` walks. No `as any`.

---

## Composing with other MCP tools

The pattern that makes Arivie a citizen of the broader ecosystem:

```ts
sources: {
  postgres: postgresAdapter({ url: process.env.DATABASE_URL! }),

  // Bring your own MCP-speaking tools — each becomes execute_<name>:
  linear:    mcpSource({ command: "linear-mcp-server", env: { LINEAR_API_KEY } }),
  slack:     mcpSource({ command: "slack-mcp-server", env: { SLACK_TOKEN } }),
  notes:     mcpSource({ command: "qmd", args: ["mcp"] }),
  filesystem: mcpSource({ command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/data"] }),
}
```

Each source becomes a typed `execute_<source>({ toolName, args })` tool on the agent. The agent decides which tool to reach for based on the prompt.

Going the other direction — expose your Arivie agent over MCP:

```bash
arivie mcp                            # stdio (subprocess transport)
arivie mcp --http --port 8181         # Streamable HTTP transport
```

Drop this into `claude_desktop_config.json` or `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "arivie": {
      "command": "arivie",
      "args": ["mcp"]
    }
  }
}
```

…and Claude Desktop, Cursor, or any MCP client can `ask`, `query`, `schema` against your warehouse with your Arivie agent doing the analysis.

---

## CLI

```bash
arivie init                 # scaffold arivie.config.ts + semantic/ + skills/
arivie setup                # DB role + Mastra Memory migrations + owner identity smoke test
arivie add entity <name>    # scaffold semantic/entities/<name>.yml
arivie add skill <name>     # scaffold skills/<name>/SKILL.md
arivie add ui <component>   # scaffold a React component for chat / etc.
arivie lint                 # validate semantic layer + emit catalog
arivie types                # generate .arivie/types.ts from semantic + skills
arivie eval                 # run golden-SQL eval suite
arivie dev                  # local dev server (Mastra panels)
arivie mcp                  # boot the MCP server (stdio | --http)
arivie deploy               # deploy recipe per target (Next, CF Workers, Bun)
```

---

## Repository layout

```
arivie/
├── packages/
│   ├── core/              # defineArivie, localWorkspace, mcpSource, AskResult
│   ├── agent/             # makeAgent, prompt assembly, contract invariants
│   ├── cli/               # arivie CLI binary (init / add / lint / types / mcp / eval / dev)
│   ├── db-postgres/       # postgresAdapter — read-only role, owner identity, session variables
│   ├── workspace/         # InProcessSandboxFilesystem, path guards, bash tool
│   ├── semantic/          # YAML loader, EntitySchema, defineEntity, codegen
│   ├── skills/            # 6 bundled SOP skill playbooks (cohort-analysis, funnel-conversion, …)
│   ├── embeddings/        # OpenAI / Cohere / Voyage providers for indexed mode
│   ├── mcp/               # Arivie-as-MCP-server (ask / query / schema / memory tools)
│   ├── source-mcp/        # MCP-as-source (consume external MCP servers as analytics sources)
│   ├── source-mixpanel/   # Mixpanel JQL adapter for event analytics
│   ├── registry/          # Component registry shapes for `arivie add ui`
│   └── react/             # Headless React hooks for chat UI
├── examples/
│   ├── with-pos-fnb/      # Full BI/BA example — F&B chain, 16 entities, 10 SOP skills
│   ├── with-nextjs/       # Next.js scaffold with HTTP route + chat UI
│   ├── with-clerk/, with-workos/, with-better-auth/, with-authjs/, with-custom-jose/  # auth integrations
│   ├── with-hono/, with-bun/, with-cloudflare-do/  # deploy targets
├── docs/                  # Astro Starlight docs site (deploys to arivie-docs.vercel.app)
├── evals/                 # golden-SQL eval suites
└── tests/                 # integration + parity tests
```

---

## How Arivie differs from other agent frameworks

| | Mastra raw | Vercel AI SDK | Dataherald | Vanna | **Arivie** |
|---|:---:|:---:|:---:|:---:|:---:|
| Single-agent default for analytics | manual | manual | ✓ | ✓ | **✓** |
| Semantic layer (YAML, typed, composable) | — | — | — | — | **✓** |
| Skills (versioned SOP playbooks) | — | — | — | — | **✓** |
| `compile_metric` (declared measures → SQL) | — | — | — | — | **✓** |
| MCP source consumer (`mcpSource()`) | via MCPClient | manual | — | — | **✓** |
| MCP server (`arivie mcp`) | manual | manual | — | — | **✓** |
| Owner-identity boundary | manual | manual | — | — | **✓** |
| Read-only DB role enforcement | manual | manual | partial | partial | **✓** |
| Codegen — typed semantic references | — | — | — | — | **✓** |
| Workspace tools (file artifacts) | manual | — | — | partial | **✓** |
| Multi-source / cross-source | manual | — | — | — | **✓** |

Arivie's design center is *"the analytics agent you ship to your tenants in a single-tenant-per-instance SaaS."* If you need a research+writing supervisor with agents-as-tools, use Mastra's supervisor pattern directly — Arivie deliberately doesn't put that in the default surface because the v0.2 reversal proved prose-paraphrase between LLMs is where weak models fabricate.

---

## Examples

Every example boots end-to-end with `pnpm install && pnpm dev`:

- **[`examples/with-pos-fnb/`](./examples/with-pos-fnb/)** — F&B chain with 16 entities, 10 SOP skills, single-agent shape, multi-provider model selector (Gemini / OpenAI / xAI). The reference example.
- **[`examples/with-nextjs/`](./examples/with-nextjs/)** — Next.js 15 App Router + streaming chat UI.
- **[`examples/with-clerk/`](./examples/with-clerk/)**, **[`with-workos/`](./examples/with-workos/)**, **[`with-better-auth/`](./examples/with-better-auth/)**, **[`with-authjs/`](./examples/with-authjs/)**, **[`with-custom-jose/`](./examples/with-custom-jose/)** — auth integration patterns.
- **[`examples/with-hono/`](./examples/with-hono/)**, **[`with-bun/`](./examples/with-bun/)**, **[`with-cloudflare-do/`](./examples/with-cloudflare-do/)** — deploy targets.

---

## Contributing

Arivie is source-available under Apache-2.0. Issues and PRs welcome — we triage daily. For substantive changes, open a discussion first; we move fast but we'd rather align on architecture before diff.

```bash
pnpm install
pnpm build       # 13 packages
pnpm test        # 505 tests across 13 suites
pnpm -C docs dev # localhost:4321 — live docs
```

---

## License

Apache-2.0 © [asyncdot engineering](https://github.com/asyncdotengineering). See [LICENSE](./LICENSE).
