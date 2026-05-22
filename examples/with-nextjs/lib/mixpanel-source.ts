/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Mixpanel source for with-nextjs — live Query API when creds are set,
 * otherwise Plan B mock (RFC-003 v2 §13 D5 / HS-5).
 */
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mixpanelAdapter, type MixpanelAdapter, type MixpanelQuery } from "@arivie/source-mixpanel";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Per-customer page-view rows aligned with seed.sql customer ids (cust-01..cust-10). */
const DEMO_PAGE_VIEW_ROWS: ReadonlyArray<{
  distinct_id: string;
  utm_source: string;
  page_view_count: number;
}> = [
  { distinct_id: "cust-01", utm_source: "google", page_view_count: 420 },
  { distinct_id: "cust-02", utm_source: "email", page_view_count: 180 },
  { distinct_id: "cust-03", utm_source: "google", page_view_count: 310 },
  { distinct_id: "cust-04", utm_source: "direct", page_view_count: 95 },
  { distinct_id: "cust-05", utm_source: "social", page_view_count: 240 },
  { distinct_id: "cust-06", utm_source: "google", page_view_count: 155 },
  { distinct_id: "cust-07", utm_source: "email", page_view_count: 88 },
  { distinct_id: "cust-08", utm_source: "paid", page_view_count: 200 },
  { distinct_id: "cust-09", utm_source: "social", page_view_count: 130 },
  { distinct_id: "cust-10", utm_source: "direct", page_view_count: 72 },
];

export interface MixpanelSourceResolution {
  readonly adapter: MixpanelAdapter;
  /** `live` | `mock-plan-b` */
  readonly mode: "live" | "mock-plan-b";
  readonly label: string;
}

/** Minimal Query API mock for introspect/probe when live creds are absent. */
function createPlanBMockFetch(): typeof fetch {
  return async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/import")) {
      return new Response(JSON.stringify({ error: "permission denied" }), { status: 403 });
    }
    if (url.includes("/events/names")) {
      return new Response(JSON.stringify(["Page Viewed", "Purchased", "Signed Up"]), {
        status: 200,
      });
    }
    if (url.includes("/segmentation")) {
      return new Response(
        JSON.stringify({
          data: { series: ["2026-01-01"], values: { "Page Viewed": { "2026-01-01": 420 } } },
          legend_size: 1,
        }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
  };
}

function hasLiveMixpanelCreds(): boolean {
  const token = process.env.MIXPANEL_PROJECT_TOKEN;
  const projectId = process.env.MIXPANEL_PROJECT_ID;
  return token != null && token.length > 0 && projectId != null && projectId.length > 0;
}

/**
 * Mock execute returns per-distinct_id rows so client-side hash-join with orders works
 * under the 10k guard (segmentation aggregates alone are not join-key shaped).
 */
function wrapMockForCrossSourceDemo(base: MixpanelAdapter): MixpanelAdapter {
  return {
    ...base,
    async execute(opts) {
      const event =
        typeof opts.query === "object" &&
        opts.query != null &&
        "event" in opts.query &&
        typeof (opts.query as MixpanelQuery).event === "string"
          ? (opts.query as MixpanelQuery).event
          : "Page Viewed";
      const rows = DEMO_PAGE_VIEW_ROWS.map((r) => ({
        distinct_id: r.distinct_id,
        utm_source: r.utm_source,
        page_view_count: r.page_view_count,
        event_name: event,
      }));
      const limited = rows.slice(0, opts.rowLimit);
      return {
        rows: limited,
        rowCount: limited.length,
        durationMs: 1,
        truncated: rows.length > opts.rowLimit,
      };
    },
  };
}

export function resolveMixpanelSource(): MixpanelSourceResolution {
  if (hasLiveMixpanelCreds()) {
    const projectId = process.env.MIXPANEL_PROJECT_ID!;
    const region = (process.env.MIXPANEL_REGION ?? "mixpanel") as
      | "mixpanel"
      | "eu.mixpanel"
      | "in.mixpanel";
    const adapter = mixpanelAdapter({
      projectToken: process.env.MIXPANEL_PROJECT_TOKEN!,
      projectId,
      region,
    });
    return {
      adapter,
      mode: "live",
      label: `MixpanelAdapter live (project ${projectId})`,
    };
  }

  const adapter = wrapMockForCrossSourceDemo(
    mixpanelAdapter({
      projectToken: "demo-readonly-mock-token",
      projectId: 0,
      skipReadOnlyProbe: true,
      fetch: createPlanBMockFetch(),
    }),
  );
  return {
    adapter,
    mode: "mock-plan-b",
    label:
      "MixpanelAdapter mock-plan-b (MIXPANEL_PROJECT_TOKEN/ID absent — per-entity rows for hash-join demo)",
  };
}

/** Stable id for logs without echoing tokens. */
export function mixpanelModeFingerprint(mode: MixpanelSourceResolution["mode"]): string {
  return createHash("sha256").update(mode).digest("hex").slice(0, 8);
}

export const skillsPackagePath = join(__dirname, "..", "..", "..", "packages", "skills");
