/* SPDX-License-Identifier: Apache-2.0 */
import type { SourceAdapter } from "@arivie/core/types";
import { describe, expect, it } from "vitest";
import {
  deriveMixpanelAdapterId,
  hashProjectToken,
  mixpanelAdapter,
} from "../src/adapter.js";
import type { MixpanelQuery } from "../src/types.js";
import {
  createMockMixpanelFetch,
  mockImportProbeWritableResponse,
} from "./fixtures/mock-mixpanel-responses.js";

describe("deriveMixpanelAdapterId", () => {
  it("uses project id and token hash, never echoes token", () => {
    const id = deriveMixpanelAdapterId(12345, "super-secret-token");
    expect(id).toBe(`mixpanel:12345:${hashProjectToken("super-secret-token")}`);
    expect(id).not.toContain("super-secret");
    expect(id).not.toContain("token");
  });
});

describe("mixpanelAdapter", () => {
  it("implements SourceAdapter with kind mixpanel", async () => {
    const adapter = mixpanelAdapter({
      projectToken: "test-token",
      projectId: 99,
      fetch: createMockMixpanelFetch(),
      skipReadOnlyProbe: true,
    });

    const _typed: SourceAdapter<MixpanelQuery> = adapter;
    void _typed;

    expect(adapter.kind).toBe("mixpanel");
    expect(adapter.id).toMatch(/^mixpanel:99:[a-f0-9]{12}$/);
    expect(adapter.compileMetric).toBeDefined();
  });

  it("throws when import probe detects write scope", async () => {
    const fetch: typeof globalThis.fetch = async (input, init?) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("/import")) {
        return mockImportProbeWritableResponse();
      }
      return createMockMixpanelFetch()(input, init);
    };

    const adapter = mixpanelAdapter({
      projectToken: "writable",
      projectId: 1,
      fetch,
    });

    await expect(
      adapter.execute({
        query: {
          event: "Page Viewed",
          from_date: "2026-05-01",
          to_date: "2026-05-07",
        },
        userId: "u1",
        rowLimit: 100,
        timeoutMs: 5000,
      }),
    ).rejects.toThrow(
      "MixpanelAdapter: read-only API token required; got token with write scope",
    );
  });

  it("verifyOwnerIdentity is a no-op", async () => {
    const adapter = mixpanelAdapter({
      projectToken: "t",
      projectId: 1,
      fetch: createMockMixpanelFetch(),
      skipReadOnlyProbe: true,
    });
    await expect(adapter.verifyOwnerIdentity("owner")).resolves.toBeUndefined();
  });

  it("caches introspect results", async () => {
    let namesCalls = 0;
    const fetch: typeof globalThis.fetch = async (input, init?) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("/events/names")) {
        namesCalls += 1;
      }
      return createMockMixpanelFetch()(input, init);
    };
    const adapter = mixpanelAdapter({
      projectToken: "t",
      projectId: 1,
      fetch,
      skipReadOnlyProbe: true,
    });
    await adapter.introspect();
    await adapter.introspect();
    expect(namesCalls).toBe(1);
  });

  it("compileMetric maps entity measure to MixpanelQuery", () => {
    const adapter = mixpanelAdapter({
      projectToken: "t",
      projectId: 1,
      fetch: createMockMixpanelFetch(),
      skipReadOnlyProbe: true,
    });

    const result = adapter.compileMetric!({
      entity: {
        name: "events",
        description: "Events",
        grain: "one row",
        primary_key: "id",
        source: { adapter: "mixpanel", instance: "primary" },
        measures: [{ name: "event_count", sql: "COUNT(*)" }],
        dimensions: [{ name: "event_name", sql: "event_name", type: "text" }],
      },
      metric: "event_count",
    });

    expect(result.query.from_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.query.to_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.query.aggregate).toBe("count");
  });
});
