/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { mixpanelAdapter } from "../src/adapter.js";
import { sumRowValues } from "../src/query.js";
import {
  createMockMixpanelFetch,
  MOCK_EVENTS,
  PAGE_VIEWED_TOTAL,
  PURCHASED_TOTAL,
  SIGNED_UP_TOTAL,
} from "./fixtures/mock-mixpanel-responses.js";

describe("mock-mixpanel-responses", () => {
  const adapter = mixpanelAdapter({
    projectToken: "fixture-token",
    projectId: 42,
    fetch: createMockMixpanelFetch(),
    skipReadOnlyProbe: true,
  });

  it("introspect returns deterministic event list", async () => {
    const events = (await adapter.introspect()) as { name: string }[];
    expect(events.map((e) => e.name)).toEqual([...MOCK_EVENTS]);
  });

  it.each([
    ["Page Viewed", PAGE_VIEWED_TOTAL],
    ["Purchased", PURCHASED_TOTAL],
    ["Signed Up", SIGNED_UP_TOTAL],
  ] as const)(
    "execute returns deterministic count for %s",
    async (event, expectedTotal) => {
      const result = await adapter.execute({
        query: {
          event,
          from_date: "2026-05-01",
          to_date: "2026-05-14",
          aggregate: "count",
        },
        userId: "test-user",
        rowLimit: 10_000,
        timeoutMs: 10_000,
      });

      const total = result.rows.reduce(
        (acc, row) => acc + Number(row.value),
        0,
      );
      expect(total).toBe(expectedTotal);
      expect(result.rowCount).toBeGreaterThan(0);
    },
  );

  it("answers Page Viewed count question shape for live demo", async () => {
    const result = await adapter.execute({
      query: {
        event: "Page Viewed",
        from_date: "2026-05-13",
        to_date: "2026-05-20",
        aggregate: "count",
      },
      userId: "demo",
      rowLimit: 1000,
      timeoutMs: 10_000,
    });
    const count = sumRowValues(
      result.rows.map((r) => ({
        date: String(r.date),
        value: Number(r.value),
      })),
    );
    expect(count).toBeGreaterThan(0);
  });
});
