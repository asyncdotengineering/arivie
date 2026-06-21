/* SPDX-License-Identifier: Apache-2.0 */
import type { DispatchMessage, RuntimeStorage } from "../storage/types.js";

/**
 * Throw from a dispatch handler to signal a TRANSIENT failure — the worker
 * backs off and retries (RFC §6.6). Any other error is treated as terminal and
 * dead-lettered. This is the explicit retry classification (RFC §10.3).
 */
export class DispatchRetryableError extends Error {
  readonly retryable = true as const;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DispatchRetryableError";
  }
}

export interface DispatchTickResult {
  claimed: number;
  completed: number;
  retried: number;
  deadLettered: number;
}

export interface DispatchWorker {
  /** Claim and process one batch. `now` is an injectable clock for tests. */
  tick(now?: number): Promise<DispatchTickResult>;
  /** Begin polling on an interval. */
  start(): void;
  /** Stop polling. */
  stop(): void;
}

/**
 * Wiring for the dispatch worker (RFC §6.6). Generic over the subscription
 * shape `TSub` so the worker stays decoupled from any concrete subscription
 * model: the host supplies `resolveSubscriptions` (which subscriptions match a
 * message) and `dispatch` (how to invoke a target — create a session, invoke a
 * workflow/capability). A handler throwing {@link DispatchRetryableError}
 * retries; any other throw dead-letters.
 */
export interface DispatchWorkerOptions<TSub> {
  storage: RuntimeStorage;
  workerId: string;
  resolveSubscriptions(message: DispatchMessage): TSub[] | Promise<TSub[]>;
  dispatch(subscription: TSub, message: DispatchMessage): Promise<void>;
  /** Messages claimed per tick (default 25). */
  batchLimit?: number;
  /** Claim lease duration in ms (default 60000). */
  leaseMs?: number;
  /** Max attempts before dead-letter (default 5). */
  maxAttempts?: number;
  /** Backoff for a given prior-attempt count (default capped exponential). */
  backoffMs?(attempt: number): number;
  /** Classify an error as retryable (default: DispatchRetryableError). */
  isRetryable?(err: unknown): boolean;
  /** Poll interval for start()/stop() in ms (default 250). */
  pollMs?: number;
}
