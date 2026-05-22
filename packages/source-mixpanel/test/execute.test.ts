/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import {
  basicAuthHeader,
  executeMixpanelQuery,
  fetchSegmentation,
  type MixpanelClientConfig,
} from "../src/execute.js";
import { parseSegmentationData, sumRowValues } from "../src/query.js";
import {
  createMockMixpanelFetch,
  PAGE_VIEWED_TOTAL,
} from "./fixtures/mock-mixpanel-responses.js";

function mockClient(): MixpanelClientConfig {
  return {
    projectToken: "mock-token",
    projectId: "123",
    queryBaseUrl: "https://mixpanel.com/api/query",
    importBaseUrl: "https://api.mixpanel.com",
    fetch: createMockMixpanelFetch(),
  };
}

describe("basicAuthHeader", () => {
  it("encodes token as Basic username with empty password", () => {
    const header = basicAuthHeader("my-secret");
    const encoded = Buffer.from("my-secret:").toString("base64");
    expect(header).toBe(`Basic ${encoded}`);
  });
});

describe("parseSegmentationData", () => {
  it("flattens series values into rows", () => {
    const rows = parseSegmentationData(
      {
        data: {
          series: ["2026-05-01", "2026-05-02"],
          values: {
            "Page Viewed": { "2026-05-01": 10, "2026-05-02": 5 },
          },
        },
      },
      "Page Viewed",
    );
    expect(rows).toHaveLength(2);
    expect(sumRowValues(rows)).toBe(15);
  });
});

describe("fetchSegmentation errors", () => {
  it("throws when Query API returns non-OK", async () => {
    await expect(
      fetchSegmentation(
        {
          ...mockClient(),
          fetch: async () =>
            new Response(JSON.stringify({ error: "bad" }), { status: 400 }),
        },
        {
          event: "X",
          from_date: "2026-05-01",
          to_date: "2026-05-02",
        },
      ),
    ).rejects.toThrow("Mixpanel Query API");
  });
});

describe("executeMixpanelQuery", () => {
  it("returns rows with duration and truncation", async () => {
    const result = await executeMixpanelQuery(mockClient(), {
      query: {
        event: "Page Viewed",
        from_date: "2026-05-01",
        to_date: "2026-05-07",
        aggregate: "count",
      },
      userId: "u1",
      rowLimit: 2,
      timeoutMs: 10_000,
    });

    expect(result.rows.length).toBe(2);
    expect(result.rowCount).toBe(2);
    expect(result.truncated).toBe(true);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("uses sum endpoint when aggregate is sum with on", async () => {
    let path = "";
    const fetch: typeof globalThis.fetch = async (input) => {
      const url = typeof input === "string" ? input : input.url;
      path = new URL(url).pathname;
      return createMockMixpanelFetch()(input);
    };
    await fetchSegmentation(
      { ...mockClient(), fetch },
      {
        event: "Purchased",
        from_date: "2026-05-01",
        to_date: "2026-05-07",
        aggregate: "sum",
        on: 'properties["amount"]',
      },
    );
    expect(path).toContain("/segmentation/sum");
  });

  it("mock fixture returns deterministic Page Viewed total", async () => {
    const raw = await fetchSegmentation(mockClient(), {
      event: "Page Viewed",
      from_date: "2026-05-01",
      to_date: "2026-05-07",
    });
    const rows = parseSegmentationData(raw, "Page Viewed");
    expect(sumRowValues(rows)).toBe(PAGE_VIEWED_TOTAL);
  });
});
