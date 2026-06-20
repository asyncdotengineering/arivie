/* SPDX-License-Identifier: Apache-2.0 */
import type { ChannelDefinition } from "./channel.js";
import type { TriggerDefinition, TriggerEvent } from "./types.js";

export type SubscriptionTargetKind = "agent" | "workflow" | "skill";

export interface SubscriptionTarget {
  kind: SubscriptionTargetKind;
  id: string;
  instanceId?: string | ((event: TriggerEvent) => string | Promise<string>);
  input?: Record<string, unknown> | ((event: TriggerEvent) => Record<string, unknown> | Promise<Record<string, unknown>>);
}

export interface SubscriptionDefinition<TEvent extends TriggerEvent = TriggerEvent> {
  source: ChannelDefinition<unknown, TEvent> | TriggerDefinition<unknown, TEvent> | string;
  filter?: (event: TEvent) => boolean;
  target: SubscriptionTarget;
}

export function defineSubscription<TEvent extends TriggerEvent>(
  subscription: SubscriptionDefinition<TEvent>,
): SubscriptionDefinition<TEvent> {
  return subscription;
}
