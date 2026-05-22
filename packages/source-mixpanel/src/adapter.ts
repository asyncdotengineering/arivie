/* SPDX-License-Identifier: Apache-2.0 */
import { createHash } from "node:crypto";
import { compileMetricForMixpanel } from "./compile-metric.js";
import { READ_ONLY_REQUIRED_MSG } from "./query.js";
import {
  executeMixpanelQuery,
  fetchEventNames,
  importApiBaseUrl,
  probeWriteScope,
  queryApiBaseUrl,
  type MixpanelClientConfig,
} from "./execute.js";
import type {
  MixpanelAdapter,
  MixpanelAdapterOptions,
  MixpanelEventInfo,
} from "./types.js";

/** Credential-safe adapter id (RFC-003 v2 §4.7). */
export function deriveMixpanelAdapterId(
  projectId: string | number,
  projectToken: string,
): string {
  const hash = createHash("sha256")
    .update(projectToken)
    .digest("hex")
    .slice(0, 12);
  return `mixpanel:${projectId}:${hash}`;
}

export function hashProjectToken(projectToken: string): string {
  return createHash("sha256").update(projectToken).digest("hex").slice(0, 12);
}

/**
 * Mixpanel Query API adapter (RFC-003 v2 REQ-41).
 *
 * Authenticates with HTTP Basic Auth: project token/secret as username, empty
 * password (see Mixpanel Project Secret / Project Token docs).
 *
 * Read-only enforcement probes the Import API on first `execute()` (Mixpanel
 * does not expose a dedicated read-only scope endpoint).
 */
export function mixpanelAdapter(opts: MixpanelAdapterOptions): MixpanelAdapter {
  const region = opts.region ?? "mixpanel";
  const projectId = String(opts.projectId);
  const clientConfig: MixpanelClientConfig = {
    projectToken: opts.projectToken,
    projectId,
    queryBaseUrl: queryApiBaseUrl(region),
    importBaseUrl: importApiBaseUrl(region),
    fetch: opts.fetch ?? globalThis.fetch,
  };

  let introspectCache: MixpanelEventInfo[] | null = null;
  let readOnlyVerified = opts.skipReadOnlyProbe === true;

  async function ensureReadOnly(): Promise<void> {
    if (readOnlyVerified) {
      return;
    }
    const writable = await probeWriteScope(clientConfig);
    readOnlyVerified = true;
    if (writable) {
      throw new Error(READ_ONLY_REQUIRED_MSG);
    }
  }

  return {
    kind: "mixpanel",
    id: deriveMixpanelAdapterId(projectId, opts.projectToken),
    async execute(executeOpts) {
      await ensureReadOnly();
      return executeMixpanelQuery(clientConfig, executeOpts);
    },
    async introspect() {
      if (introspectCache != null) {
        return introspectCache;
      }
      await ensureReadOnly();
      const names = await fetchEventNames(clientConfig);
      introspectCache = names.map((name) => ({ name }));
      return introspectCache;
    },
    async verifyOwnerIdentity(): Promise<void> {},
    compileMetric: compileMetricForMixpanel,
  };
}
