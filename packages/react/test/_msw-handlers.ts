/* SPDX-License-Identifier: Apache-2.0 */
import { http, HttpResponse } from "msw";

const ORIGIN = "http://localhost";
const AGENT_ENDPOINT = `${ORIGIN}/api/arivie`;
const SCHEMA_ENDPOINT = `${ORIGIN}/api/arivie/schema`;
const MEMORY_ENDPOINT = `${ORIGIN}/api/arivie/memory`;

function ssePayload(chunks: string[]): string {
  return chunks.map((chunk) => `data: ${chunk}\n\n`).join("");
}

export const handlers = [
  http.post(AGENT_ENDPOINT, async ({ request }) => {
    const body = (await request.json()) as { prompt?: string };
    if (body.prompt === "fail") {
      return HttpResponse.json({ error: "internal" }, { status: 500 });
    }
    if (body.prompt === "abort-me") {
      return new HttpResponse(ssePayload(["partial "]), {
        headers: { "Content-Type": "text/event-stream" },
      });
    }
    return new HttpResponse(
      ssePayload([
        "Hello ",
        "world",
        "[DONE]",
        JSON.stringify({
          sql: "SELECT 1",
          rowCount: 1,
          rows: [{ n: 1 }],
          toolResults: [
            {
              toolName: "execute_postgres",
              args: { sql: "SELECT 1" },
              result: { rowCount: 1 },
              durationMs: 12,
            },
          ],
        }),
      ]),
      {
        headers: { "Content-Type": "text/event-stream" },
      },
    );
  }),

  http.get(SCHEMA_ENDPOINT, () =>
    HttpResponse.json({
      catalog: { version: "0.1" },
      entities: [{ name: "orders" }],
      owner: { id: "owner-1", name: "Acme" },
    }),
  ),

  http.get(`${ORIGIN}/api/arivie-v2/schema`, () =>
    HttpResponse.json({
      catalog: { version: "0.1" },
      entities: [{ name: "orders" }],
      owner: { id: "owner-1", name: "Acme" },
    }),
  ),

  http.get(MEMORY_ENDPOINT, () =>
    HttpResponse.json({
      memories: [{ key: "revenue", value: "net of refunds" }],
    }),
  ),

  http.post(MEMORY_ENDPOINT, async ({ request }) => {
    const body = (await request.json()) as { key: string; value: string };
    return HttpResponse.json({
      memories: [{ key: body.key, value: body.value }],
    });
  }),

  http.delete(MEMORY_ENDPOINT, async ({ request }) => {
    const body = (await request.json()) as { key: string };
    if (body.key === "missing") {
      return HttpResponse.json({ error: "not found" }, { status: 404 });
    }
    return HttpResponse.json({ memories: [] });
  }),
];

export const ENDPOINTS = {
  agent: AGENT_ENDPOINT,
  schema: `${ORIGIN}/api/arivie`,
  schemaV2: `${ORIGIN}/api/arivie-v2`,
  memory: `${ORIGIN}/api/arivie`,
};
