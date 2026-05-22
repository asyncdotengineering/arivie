# @arivie/registry

Local filesystem component registry for Arivie v0.1 (REQ-28, RFC §4.9). **Not published to npm** — `private: true`.

Eight shadcn-style UI scaffolds live in subdirectories (`agent-chat/`, `sql-inspector/`, …). Each folder contains:

- `registry-item.json` — manifest (`dependencies`, `shadcnDependencies`, consumer-relative `files[]`)
- Source `.tsx` (and optional `.css`) copied into the consumer app by `arivie add ui <name>` (Sprint 3 C27)

## Validation

```bash
pnpm --filter @arivie/registry validate
pnpm --filter @arivie/registry test
```

`scripts/validate-registry.ts` checks every manifest against the Zod schema in `registry.schema.json` and verifies listed files exist on disk.

## Components

| Name | Hook / data |
|------|-------------|
| `agent-chat` | `useAgent` + AI Elements |
| `sql-inspector` | `sql` prop |
| `run-timeline` | `messages[].timeline` |
| `eval-diff` | golden vs agent SQL |
| `semantic-browser` | `useSchema` |
| `memory-editor` | `useMemory` |
| `workflow-list` | v0.1 stub |
| `owner-context-badge` | `useSchema().owner` |

Distribution for v0.1 is **monorepo-local only** (manager grill Q1). GitHub Raw fetch is deferred to v0.2.
