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

Arivie v2.2.0 — deeper semantic layer + Mastra-native embeddings.

Semantic-layer accuracy fields (the moat):
- **Glossary** with `status: ambiguous` — ambiguous business terms make the agent ASK a clarifying question instead of guessing (authored in `glossary.yml`).
- **`sample_values`** on dimensions — illustrative real values for high-cardinality columns; grounds WHERE filters.
- **`metrics.objective`** (maximize | minimize) — correct best/worst/top/bottom ranking.
- `example_queries` reframed as "canonical query patterns" in the prompt.

`@arivie/embeddings`: the 3 hard-coded provider factories collapse into one `modelRouterEmbeddings(modelId, { dimensions })` over Mastra's model router (40+ providers). The entity-aware `ParagraphChunker` + `buildIndex`/`retrieve` stay.
