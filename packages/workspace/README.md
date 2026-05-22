# @arivie/workspace

Read-only Mastra `WorkspaceFilesystem` implementation for the Arivie semantic layer. Proxies read operations to Node `fs/promises` under a configured `rootDir`; all write operations throw `ReadOnlyError`.

Full contract: [RFC-002 §4.3](../../../.research/07-rfc/RFC-002-concrete-tech-implementation/02-requirements-interfaces.md).
