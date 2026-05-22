/* SPDX-License-Identifier: Apache-2.0 */
import type { SourceAdapter } from "@arivie/core/types";

/** Segmentation query routed to the Mixpanel Query API. */
export interface MixpanelQuery {
  event?: string;
  aggregate?: "count" | "sum" | "average";
  from_date: string;
  to_date: string;
  where?: string;
  on?: string;
}

export interface MixpanelAdapterOptions {
  /** Project API secret or service-account credential (HTTP Basic username). */
  projectToken: string;
  projectId: number | string;
  name?: string;
  /** Query API host prefix, e.g. `mixpanel` (US) or `eu.mixpanel`. */
  region?: "mixpanel" | "eu.mixpanel" | "in.mixpanel";
  /** Override for tests — custom fetch implementation. */
  fetch?: typeof globalThis.fetch;
  /** When true, skip the read-only import probe (tests only). */
  skipReadOnlyProbe?: boolean;
}

export type MixpanelAdapter = SourceAdapter<MixpanelQuery>;

export interface MixpanelEventInfo {
  name: string;
}
