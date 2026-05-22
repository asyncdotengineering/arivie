# @arivie/db-postgres

Postgres connection adapter for Arivie: role-scoped `execute` (optional `params?: readonly unknown[]` threaded to `sql.unsafe(query, params)` for `$1`/`$2` placeholders), schema `introspect`, owner-identity verification, and idempotent read-only role setup.

Full contract: [RFC-002 §4.5](../../../.research/07-rfc/RFC-002-concrete-tech-implementation/02-requirements-interfaces.md#45-anaclipdb-postgres--postgres-adapter).
