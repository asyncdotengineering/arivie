/* SPDX-License-Identifier: Apache-2.0 */
export async function POST(): Promise<Response> {
  return Response.json(
    { error: "mcp_unavailable", message: "The v2 ArivieApp runtime no longer exposes the legacy raw agent required by this MCP demo route." },
    { status: 410 },
  );
}
