/* SPDX-License-Identifier: Apache-2.0 */
import { createHash } from "node:crypto";
import type { AdmitDispatchResult, RuntimeStorage } from "../storage/types.js";

/** Minimal shape a channel event must have for dedupe-key derivation. */
export interface DispatchableEvent {
  payload?: unknown;
  metadata?: { deliveryId?: string };
}

/**
 * Derive a dedupe key for an inbound channel event (RFC §6.5): the provider's
 * delivery id when present (the authoritative idempotency key), else a sha256
 * of the channel + payload. Namespaced by channel so identical payloads on
 * different channels stay distinct.
 */
export function dispatchDedupeKey(channel: string, event: DispatchableEvent): string {
  const delivery = event.metadata?.deliveryId;
  if (typeof delivery === "string" && delivery.length > 0) {
    return `${channel}:delivery:${delivery}`;
  }
  const hash = createHash("sha256")
    .update(channel)
    .update("\0")
    .update(JSON.stringify(event.payload ?? null))
    .digest("hex");
  return `${channel}:sha256:${hash}`;
}

/**
 * Admit an inbound channel event into the persisted dispatch queue (RFC §6.5).
 * Idempotent by dedupe key: a duplicate delivery returns the existing message
 * with `duplicate: true` and is NOT processed twice.
 */
export async function admitChannelEvent(
  storage: RuntimeStorage,
  channel: string,
  event: DispatchableEvent,
  now?: number,
): Promise<AdmitDispatchResult> {
  const dedupeKey = dispatchDedupeKey(channel, event);
  return storage.dispatch.admit({
    channel,
    event,
    dedupeKey,
    ...(now !== undefined ? { now } : {}),
  });
}
