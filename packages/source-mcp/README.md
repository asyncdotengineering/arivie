# @arivie/source-mcp

Wraps [`@mastra/mcp`](https://www.npmjs.com/package/@mastra/mcp) `MCPClient` as an Arivie `SourceAdapter`, with tool namespacing for multi-source agents. See RFC-003 v2 §4.9 (REQ-45) in `.research/07-rfc/RFC-003-multi-adapter-and-skills/`.

## Trust boundary

MCP servers are a trust boundary. Arivie does not validate or sanitize tool args passed to the MCP server — namespaced tools and `execute_<sourceName>` forward `args` as-is to `MCPClient.callTool`. The consumer is responsible for ensuring the MCP server is trusted and that tool inputs cannot escape the intended scope (SQL, filesystem paths, etc.).
