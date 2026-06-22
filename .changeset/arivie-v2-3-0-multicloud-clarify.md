---
"@arivie/core": minor
"@arivie/context": minor
"@arivie/agent": minor
"@arivie/cli": minor
"@arivie/db-postgres": minor
"@arivie/embeddings": minor
"@arivie/github": minor
"@arivie/mcp": minor
"@arivie/plugin-analytics": minor
"@arivie/plugin-github": minor
"@arivie/plugin-postgres": minor
"@arivie/react": minor
"@arivie/semantic": minor
"@arivie/source-mcp": minor
"@arivie/source-mixpanel": minor
"@arivie/ui-catalog": minor
"@arivie/workspace": minor
---

Arivie v2.3.0 — multi-cloud serverless deployment + clarify-once.

- **Multi-cloud storage defaults** (`@arivie/core`): zero-config memory and the
  default context vector store now degrade across the filesystem reality —
  `./.arivie` (dev) → OS temp dir (Vercel/Lambda/Netlify) → in-memory (no-FS like
  Cloudflare Workers) — instead of crashing with `ENOENT mkdir '.arivie'` on a
  read-only serverless FS. Pass `memory`/`vector` with a hosted store for
  cross-invocation persistence.
- **Clarify-once** (`@arivie/agent`): the glossary `status: ambiguous` rule now
  EXITS — ask one clarifying question only when the user hasn't indicated which
  sense they mean, then act on their answer. Fixes a production re-clarification
  loop.
- Docs: a multi-cloud Deployment guide + ADR 0005 (reference deployment).
