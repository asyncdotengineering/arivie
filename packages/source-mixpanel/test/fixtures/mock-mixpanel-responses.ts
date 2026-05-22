/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Deterministic Mixpanel Query API responses for unit tests.
 * Events: Page Viewed, Purchased, Signed Up.
 */

export const MOCK_EVENTS = ["Page Viewed", "Purchased", "Signed Up"] as const;

const PAGE_VIEWED_TOTAL = 420;
const PURCHASED_TOTAL = 87;
const SIGNED_UP_TOTAL = 156;

function segmentationBody(
  event: string,
  total: number,
  fromDate: string,
  toDate: string,
): unknown {
  const mid = midpointDate(fromDate, toDate);
  const half = Math.floor(total / 2);
  return {
    data: {
      series: [fromDate, mid, toDate],
      values: {
        [event]: {
          [fromDate]: half,
          [mid]: total - half - 1,
          [toDate]: 1,
        },
      },
    },
    legend_size: 1,
  };
}

function midpointDate(from: string, to: string): string {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  const mid = new Date(Math.floor((a + b) / 2));
  return mid.toISOString().slice(0, 10);
}

function eventTotal(event: string | null): number {
  switch (event) {
    case "Page Viewed":
      return PAGE_VIEWED_TOTAL;
    case "Purchased":
      return PURCHASED_TOTAL;
    case "Signed Up":
      return SIGNED_UP_TOTAL;
    default:
      return 0;
  }
}

export function mockEventsNamesResponse(): string[] {
  return [...MOCK_EVENTS];
}

export function mockSegmentationResponse(
  event: string | null,
  fromDate: string,
  toDate: string,
): unknown {
  if (event == null || event === "") {
    return { data: { series: [], values: {} }, legend_size: 0 };
  }
  return segmentationBody(event, eventTotal(event), fromDate, toDate);
}

export function mockImportProbeResponse(): Response {
  return new Response(JSON.stringify({ error: "permission denied" }), {
    status: 403,
    headers: { "Content-Type": "application/json" },
  });
}

export function mockImportProbeWritableResponse(): Response {
  return new Response(JSON.stringify({ status: "ok", code: 200 }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** In-memory fetch for Query API + Import probe. */
export function createMockMixpanelFetch(): typeof fetch {
  return async (input, init?) => {
    const url = typeof input === "string" ? input : input.url;
    const method = init?.method ?? (typeof input !== "string" ? input.method : "GET");

    if (url.includes("/import")) {
      return mockImportProbeResponse();
    }

    if (url.includes("/events/names")) {
      return new Response(JSON.stringify(mockEventsNamesResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.includes("/segmentation")) {
      const parsed = new URL(url);
      const event = parsed.searchParams.get("event");
      const fromDate = parsed.searchParams.get("from_date") ?? parsed.searchParams.get("fromDate") ?? "2026-01-01";
      const toDate = parsed.searchParams.get("to_date") ?? parsed.searchParams.get("toDate") ?? "2026-01-07";
      const body = mockSegmentationResponse(event, fromDate, toDate);
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
  };
}

export { PAGE_VIEWED_TOTAL, PURCHASED_TOTAL, SIGNED_UP_TOTAL };
