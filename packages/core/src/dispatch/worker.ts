/* SPDX-License-Identifier: Apache-2.0 */
import type { DispatchMessage } from "../storage/types.js";
import {
  DispatchRetryableError,
  type DispatchTickResult,
  type DispatchWorker,
  type DispatchWorkerOptions,
} from "./types.js";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function defaultBackoff(attempt: number): number {
  return Math.min(60_000, 1000 * 2 ** attempt);
}

/**
 * Create the persisted-dispatch worker (RFC §6.6). Each `tick` atomically
 * claims a batch under a lease, resolves matching subscriptions, dispatches
 * each, and `complete`s the message. A {@link DispatchRetryableError} (or a
 * custom `isRetryable`) reschedules with backoff until `maxAttempts`, after
 * which — and for any terminal error — the message is dead-lettered. Because
 * claiming goes through {@link DispatchQueueStore.claimReady}, two workers
 * never process the same message (RFC §11 abort criterion).
 */
export function createDispatchWorker<TSub>(
  options: DispatchWorkerOptions<TSub>,
): DispatchWorker {
  const {
    storage,
    workerId,
    resolveSubscriptions,
    dispatch,
    batchLimit = 25,
    leaseMs = 60_000,
    maxAttempts = 5,
    pollMs = 250,
  } = options;
  const backoffMs = options.backoffMs ?? defaultBackoff;
  const isRetryable =
    options.isRetryable ?? ((err: unknown) => err instanceof DispatchRetryableError);

  let timer: ReturnType<typeof setInterval> | undefined;
  let ticking = false;

  async function processMessage(
    message: DispatchMessage,
    now: number | undefined,
    result: DispatchTickResult,
  ): Promise<void> {
    try {
      const subscriptions = await resolveSubscriptions(message);
      for (const subscription of subscriptions) {
        await dispatch(subscription, message);
      }
      await storage.dispatch.complete(message.id);
      result.completed += 1;
    } catch (err) {
      const attemptsAfter = message.attempts + 1;
      if (isRetryable(err) && attemptsAfter < maxAttempts) {
        await storage.dispatch.retryLater(message.id, {
          backoffMs: backoffMs(message.attempts),
          error: errorMessage(err),
          ...(now !== undefined ? { now } : {}),
        });
        result.retried += 1;
      } else {
        await storage.dispatch.deadLetter(message.id, errorMessage(err));
        result.deadLettered += 1;
      }
    }
  }

  async function tick(now?: number): Promise<DispatchTickResult> {
    const result: DispatchTickResult = {
      claimed: 0,
      completed: 0,
      retried: 0,
      deadLettered: 0,
    };
    const messages = await storage.dispatch.claimReady({
      limit: batchLimit,
      leaseMs,
      workerId,
      ...(now !== undefined ? { now } : {}),
    });
    result.claimed = messages.length;
    for (const message of messages) {
      await processMessage(message, now, result);
    }
    return result;
  }

  return {
    tick,
    start() {
      if (timer !== undefined) return;
      timer = setInterval(() => {
        if (ticking) return;
        ticking = true;
        void tick().finally(() => {
          ticking = false;
        });
      }, pollMs);
      // Do not keep the event loop alive solely for polling.
      timer.unref?.();
    },
    stop() {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    },
  };
}
