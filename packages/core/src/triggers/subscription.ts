/* SPDX-License-Identifier: Apache-2.0 */
import type { ChannelDefinition } from "./channel.js";
import type { TriggerDefinition, TriggerEvent } from "./types.js";

export type SubscriptionTargetKind = "agent" | "workflow" | "skill";

export type SubscriptionInput =
  | string
  | number
  | boolean
  | null
  | Record<string, unknown>
  | unknown[];

export interface SubscriptionTarget<TEvent extends TriggerEvent = TriggerEvent> {
  kind: SubscriptionTargetKind;
  id: string;
  instanceId?: string | ((event: TEvent) => string | Promise<string>);
  resourceId?: string | ((event: TEvent) => string | Promise<string>);
  input?: SubscriptionInput | ((event: TEvent) => SubscriptionInput | Promise<SubscriptionInput>);
}

export interface SubscriptionDefinition<TEvent extends TriggerEvent = TriggerEvent> {
  source: ChannelDefinition<unknown, TEvent> | TriggerDefinition<unknown, TEvent> | string;
  filter?: (event: TEvent) => boolean;
  target: SubscriptionTarget<TEvent>;
}

export function defineSubscription<TEvent extends TriggerEvent>(
  subscription: SubscriptionDefinition<TEvent>,
): SubscriptionDefinition<TEvent> {
  return subscription;
}
