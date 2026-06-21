/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { InMemoryRuntimeStorage } from "../../src/storage/index.js";
import {
  admitChannelEvent,
  createDispatchWorker,
  dispatchDedupeKey,
  DispatchRetryableError,
} from "../../src/dispatch/index.js";
import type { DispatchMessage } from "../../src/storage/index.js";

const CH = "github";

describe("admission + dedupe (RFC §6.5)", () => {
  it("derives a delivery-id dedupe key when present, else a payload hash", () => {
    const byDelivery = dispatchDedupeKey(CH, { metadata: { deliveryId: "d1" }, payload: { a: 1 } });
    expect(byDelivery).toBe("github:delivery:d1");
    const byHash = dispatchDedupeKey(CH, { payload: { a: 1 } });
    expect(byHash.startsWith("github:sha256:")).toBe(true);
    // Same payload → same key; different payload → different key.
    expect(dispatchDedupeKey(CH, { payload: { a: 1 } })).toBe(byHash);
    expect(dispatchDedupeKey(CH, { payload: { a: 2 } })).not.toBe(byHash);
  });

  it("admits a duplicate delivery only once", async () => {
    const storage = new InMemoryRuntimeStorage();
    const event = { metadata: { deliveryId: "d1" }, payload: { x: 1 } };
    const first = await admitChannelEvent(storage, CH, event, 1000);
    const second = await admitChannelEvent(storage, CH, event, 1000);
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.message.id).toBe(first.message.id);
  });
});

describe("dispatch worker (RFC §6.6)", () => {
  function setup(dispatch: (sub: string, m: DispatchMessage) => Promise<void>) {
    const storage = new InMemoryRuntimeStorage();
    const worker = createDispatchWorker<string>({
      storage,
      workerId: "w1",
      resolveSubscriptions: () => ["sub-a"],
      dispatch,
      maxAttempts: 3,
      backoffMs: () => 1000,
    });
    return { storage, worker };
  }

  it("dispatches matched subscriptions then completes the message", async () => {
    const seen: string[] = [];
    const { storage, worker } = setup(async (sub) => {
      seen.push(sub);
    });
    const admit = await admitChannelEvent(storage, CH, { metadata: { deliveryId: "d1" }, payload: {} }, 0);
    const result = await worker.tick(0);
    expect(result).toMatchObject({ claimed: 1, completed: 1, retried: 0, deadLettered: 0 });
    expect(seen).toEqual(["sub-a"]);
    expect((await storage.dispatch.get(admit.message.id))?.status).toBe("completed");
  });

  it("retries a retryable failure with backoff, then succeeds", async () => {
    let attempts = 0;
    const { storage, worker } = setup(async () => {
      attempts += 1;
      if (attempts < 2) throw new DispatchRetryableError("transient");
    });
    const admit = await admitChannelEvent(storage, CH, { metadata: { deliveryId: "d1" }, payload: {} }, 0);

    const t1 = await worker.tick(0);
    expect(t1).toMatchObject({ claimed: 1, retried: 1, completed: 0 });
    expect((await storage.dispatch.get(admit.message.id))?.status).toBe("queued");

    // Still backed off at t=500 (backoff 1000) → nothing claimed.
    expect((await worker.tick(500)).claimed).toBe(0);

    // After backoff elapses → claimed and completed.
    const t2 = await worker.tick(2000);
    expect(t2).toMatchObject({ claimed: 1, completed: 1 });
    expect((await storage.dispatch.get(admit.message.id))?.status).toBe("completed");
    expect(attempts).toBe(2);
  });

  it("dead-letters a terminal (non-retryable) failure immediately", async () => {
    const { storage, worker } = setup(async () => {
      throw new Error("fatal");
    });
    const admit = await admitChannelEvent(storage, CH, { metadata: { deliveryId: "d1" }, payload: {} }, 0);
    const result = await worker.tick(0);
    expect(result).toMatchObject({ deadLettered: 1, retried: 0 });
    const msg = await storage.dispatch.get(admit.message.id);
    expect(msg?.status).toBe("dead_letter");
    expect(msg?.lastError).toBe("fatal");
  });

  it("dead-letters after maxAttempts retryable failures", async () => {
    const { storage, worker } = setup(async () => {
      throw new DispatchRetryableError("always transient");
    });
    const admit = await admitChannelEvent(storage, CH, { metadata: { deliveryId: "d1" }, payload: {} }, 0);
    // maxAttempts = 3: attempts 0,1 retry; attempt 2 dead-letters.
    await worker.tick(0); // attempts 0 -> retry (queued)
    await worker.tick(10_000); // attempts 1 -> retry
    await worker.tick(20_000); // attempts 2 -> dead-letter
    expect((await storage.dispatch.get(admit.message.id))?.status).toBe("dead_letter");
  });

  it("never double-dispatches a deduped message across concurrent workers", async () => {
    const storage = new InMemoryRuntimeStorage();
    let dispatched = 0;
    const make = (id: string) =>
      createDispatchWorker<string>({
        storage,
        workerId: id,
        resolveSubscriptions: () => ["s"],
        dispatch: async () => {
          dispatched += 1;
        },
      });
    const wA = make("wA");
    const wB = make("wB");
    await admitChannelEvent(storage, CH, { metadata: { deliveryId: "solo" }, payload: {} }, 0);
    await Promise.all([wA.tick(0), wB.tick(0)]);
    expect(dispatched).toBe(1);
  });
});
