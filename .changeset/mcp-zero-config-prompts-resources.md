---
"@arivie/mcp": minor
---

Zero-config MCP server + prompts + resources.

- `npx -y @arivie/mcp` now boots a stdio MCP server with no configuration (new `arivie-mcp` bin). Tools, prompts, and resources are listable immediately; `DATABASE_URL` / `ARIVIE_SEMANTIC_PATH` upgrade it in place, and `query`/`ask` return actionable "configure X" errors when their dependency is unset.
- `makeMcpServer` now registers MCP **prompts** (`analyze-metric`, `explore-schema`, `weekly-revenue-review`) and **resources** (`arivie://about`, `arivie://semantic/catalog`, `arivie://semantic/entity/{name}`) in addition to the `ask`/`query`/`schema`/`memory` tools.
- `makeMcpServer` options (`agent`, `semantic`, `db`, `ownerId`, `ownerName`) are now all optional; with none it serves a built-in sample semantic layer. `makeMcpUiServer` still requires `agent`/`db`/`semantic`.
