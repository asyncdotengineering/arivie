/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { mixpanelAdapter } from "../src/adapter.js";
import { sumRowValues } from "../src/query.js";

const token = process.env.MIXPANEL_TOKEN;
const projectId = process.env.MIXPANEL_PROJECT_ID;

function last7Days(): { from_date: string; to_date: string } {
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 6);
  return {
    from_date: from.toISOString().slice(0, 10),
    to_date: to.toISOString().slice(0, 10),
  };
}

const describeLive =
  token && projectId
    ? describe
    : describe.skip;

if (!token || !projectId) {
  console.log("[HS-5] Mixpanel creds missing — running mock-only");
}

describeLive("Mixpanel live integration", () => {
  it("counts Page Viewed events in the last 7 days", async () => {
    const adapter = mixpanelAdapter({
      projectToken: token!,
      projectId: projectId!,
    });
    const range = last7Days();
    const result = await adapter.execute({
      query: {
        event: "Page Viewed",
        ...range,
        aggregate: "count",
      },
      userId: "live-test",
      rowLimit: 10_000,
      timeoutMs: 60_000,
    });

    const total = sumRowValues(
      result.rows.map((r) => ({
        date: String(r.date),
        value: Number(r.value),
      })),
    );
    expect(total).toBeGreaterThan(0);
  }, 90_000);
});
