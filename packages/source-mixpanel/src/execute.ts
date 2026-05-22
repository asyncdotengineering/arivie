/* SPDX-License-Identifier: Apache-2.0 */
import type { SourceAdapterExecuteOpts, SourceAdapterExecuteResult } from "@arivie/core/types";
import {
  buildSegmentationSearchParams,
  buildSumSearchParams,
  parseSegmentationData,
  requiresSumEndpoint,
} from "./query.js";
import type { MixpanelQuery } from "./types.js";

export interface MixpanelClientConfig {
  projectToken: string;
  projectId: string;
  queryBaseUrl: string;
  importBaseUrl: string;
  fetch: typeof globalThis.fetch;
}

export function queryApiBaseUrl(
  region: "mixpanel" | "eu.mixpanel" | "in.mixpanel" = "mixpanel",
): string {
  return `https://${region}.com/api/query`;
}

export function importApiBaseUrl(
  region: "mixpanel" | "eu.mixpanel" | "in.mixpanel" = "mixpanel",
): string {
  const host = region === "mixpanel" ? "api.mixpanel.com" : `api.${region}.com`;
  return `https://${host}`;
}

export function basicAuthHeader(projectToken: string): string {
  const encoded = Buffer.from(`${projectToken}:`).toString("base64");
  return `Basic ${encoded}`;
}

async function mixpanelGet(
  config: MixpanelClientConfig,
  path: string,
  params: URLSearchParams,
  signal?: AbortSignal,
): Promise<unknown> {
  const url = `${config.queryBaseUrl}${path}?${params.toString()}`;
  const init: RequestInit = {
    method: "GET",
    headers: {
      Authorization: basicAuthHeader(config.projectToken),
      Accept: "application/json",
    },
  };
  if (signal != null) {
    init.signal = signal;
  }
  const res = await config.fetch(url, init);
  const text = await res.text();
  let body: unknown = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = { raw: text };
    }
  }
  if (!res.ok) {
    const detail =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : text.slice(0, 200);
    throw new Error(
      `Mixpanel Query API ${path} failed (${res.status}): ${detail}`,
    );
  }
  return body;
}

/**
 * Probes the Import API to detect write-capable credentials.
 *
 * Mixpanel does not expose a dedicated "read-only" scope flag on tokens.
 * When import accepts data (HTTP 200 with success), the credential can write.
 * Documented limitation: enforcement depends on the token permissions the
 * consumer configured in Mixpanel project settings.
 */
export async function probeWriteScope(
  config: MixpanelClientConfig,
): Promise<boolean> {
  const url = `${config.importBaseUrl}/import?strict=1&project_id=${encodeURIComponent(config.projectId)}`;
  const probeBody = JSON.stringify([
    {
      event: "__arivie_readonly_probe__",
      properties: {
        distinct_id: "__arivie_probe__",
        time: Math.floor(Date.now() / 1000),
        $insert_id: `arivie-probe-${Date.now()}`,
      },
    },
  ]);
  const res = await config.fetch(url, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(config.projectToken),
      "Content-Type": "application/json",
    },
    body: probeBody,
  });
  if (res.status === 401 || res.status === 403) {
    return false;
  }
  const text = await res.text();
  if (!res.ok) {
    return false;
  }
  try {
    const parsed = JSON.parse(text) as { status?: string; code?: number };
    if (parsed.status === "ok" || parsed.code === 200) {
      return true;
    }
  } catch {
    // Non-JSON success body — treat as writable.
    if (res.ok) {
      return true;
    }
  }
  return false;
}

export async function fetchSegmentation(
  config: MixpanelClientConfig,
  query: MixpanelQuery,
  signal?: AbortSignal,
): Promise<unknown> {
  if (requiresSumEndpoint(query)) {
    const params = buildSumSearchParams(query, config.projectId);
    return mixpanelGet(config, "/segmentation/sum", params, signal);
  }
  const params = buildSegmentationSearchParams(query, config.projectId);
  return mixpanelGet(config, "/segmentation", params, signal);
}

export async function fetchEventNames(
  config: MixpanelClientConfig,
): Promise<string[]> {
  const params = new URLSearchParams();
  params.set("project_id", config.projectId);
  params.set("type", "general");
  const body = await mixpanelGet(config, "/events/names", params);
  if (Array.isArray(body)) {
    return body.filter((x): x is string => typeof x === "string");
  }
  return [];
}

export async function executeMixpanelQuery(
  config: MixpanelClientConfig,
  opts: SourceAdapterExecuteOpts<MixpanelQuery>,
): Promise<SourceAdapterExecuteResult<Record<string, unknown>>> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs);

  try {
    const raw = await fetchSegmentation(config, opts.query, controller.signal);
    const parsed = parseSegmentationData(raw, opts.query.event);
    const rows = parsed.map((r) => ({
      date: r.date,
      value: r.value,
      event: r.event ?? opts.query.event,
      segment: r.segment,
    }));
    const truncated = rows.length > opts.rowLimit;
    const limited = rows.slice(0, opts.rowLimit);
    return {
      rows: limited,
      rowCount: limited.length,
      durationMs: Date.now() - startedAt,
      truncated,
    };
  } finally {
    clearTimeout(timeout);
  }
}
