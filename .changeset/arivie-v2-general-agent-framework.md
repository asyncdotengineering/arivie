---
"@arivie/core": major
"@arivie/cli": major
"@arivie/agent": major
"@arivie/context": major
"@arivie/db-postgres": major
"@arivie/embeddings": major
"@arivie/github": major
"@arivie/mcp": major
"@arivie/plugin-analytics": major
"@arivie/plugin-github": major
"@arivie/plugin-postgres": major
"@arivie/react": major
"@arivie/semantic": major
"@arivie/source-mcp": major
"@arivie/source-mixpanel": major
"@arivie/ui-catalog": major
"@arivie/workspace": major
---

Arivie v2.0.0 — general-agent-framework release.

`@arivie/core` is now a domain-neutral agent framework: a plugin SDK
(`definePlugin`), runtime storage + dispatch, an event/session/run surface, a
Hono HTTP server, and `defineArivie` as the app builder. Analytics is demoted
to a first-party plugin (`@arivie/plugin-analytics`), alongside
`@arivie/plugin-postgres` and `@arivie/plugin-github`; context layers move to
`@arivie/context`.

Highlights: Mastra Memory wired through the session as the conversation thread;
durable LibSQL memory by default (history persists + resumes across restarts);
`arivie chat` terminal client with an Ink TUI (streaming, thread picker/resume)
and a non-TTY REPL fallback; `arivie info` manifest inspection; `.env` autoload
for configs; optional DB role for queries (SELECT-only SQL guard always on).

BREAKING: the analytics-specific `@arivie/core` API is replaced by the plugin
SDK + `defineArivie`. All packages move to 2.0.0 together.
