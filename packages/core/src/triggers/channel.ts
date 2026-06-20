/* SPDX-License-Identifier: Apache-2.0 */
import type { TriggerDefinition, TriggerEvent } from "./types.js";

export interface ChannelDefinition<TConfig, TEvents extends TriggerEvent> {
  name: string;
  trigger: TriggerDefinition<TConfig, TEvents>;
  config: TConfig;
}

export function defineChannel<TConfig, TEvents extends TriggerEvent>(
  channel: ChannelDefinition<TConfig, TEvents>,
): ChannelDefinition<TConfig, TEvents> {
  if (!channel.name || typeof channel.name !== "string") {
    throw new Error("Channel name must be a non-empty string");
  }
  if (channel.name.includes("/")) {
    throw new Error(`Channel name must not contain "/": ${channel.name}`);
  }
  return channel;
}
