/* SPDX-License-Identifier: Apache-2.0 */
import type { Context, MiddlewareHandler } from "hono";
import type { ArivieInstance } from "../types.js";
import type { ChannelDefinition } from "../triggers/channel.js";
import type { SubscriptionDefinition } from "../triggers/subscription.js";
import type { TriggerEvent } from "../triggers/types.js";
import { dispatchEvent } from "./dispatch.js";

export interface ChannelRouteOptions {
  channels: ChannelDefinition<unknown, TriggerEvent>[];
  subscriptions: SubscriptionDefinition<TriggerEvent>[];
  instance: ArivieInstance;
}

function normalizeChannelMap(
  channels: ChannelDefinition<unknown, TriggerEvent>[],
): Map<string, ChannelDefinition<unknown, TriggerEvent>> {
  const map = new Map<string, ChannelDefinition<unknown, TriggerEvent>>();
  for (const channel of channels) {
    if (map.has(channel.name)) {
      throw new Error(`Duplicate channel name: ${channel.name}`);
    }
    map.set(channel.name, channel);
  }
  return map;
}

export function makeChannelRouteHandler(
  options: ChannelRouteOptions,
): MiddlewareHandler {
  const channelMap = normalizeChannelMap(options.channels);

  return async (c: Context) => {
    const name = c.req.param("name") ?? "";
    const suffix = c.req.param("suffix") ?? "";
    const channel = channelMap.get(name);

    if (!channel) {
      return c.json({ error: "channel_not_found" }, 404);
    }

    const requestedPath = suffix.length > 0 ? `/${suffix}` : "/";
    const route = channel.trigger.routes.find(
      (r) => r.method === c.req.method && r.path === requestedPath,
    );

    if (!route) {
      const allowed = channel.trigger.routes
        .filter((r) => r.path === requestedPath)
        .map((r) => r.method);
      if (allowed.length > 0) {
        c.header("Allow", allowed.join(", "));
        return c.json({ error: "method_not_allowed" }, 405);
      }
      return c.json({ error: "route_not_found" }, 404);
    }

    const triggerContext = {
      c,
      config: channel.config,
      emit: async (event: TriggerEvent) => {
        await dispatchEvent(event, channel.name, options.instance, options.subscriptions);
      },
    };

    const result = await route.handler(triggerContext);
    if (result instanceof Response) return result;
    if (result === undefined || result === null) return c.body(null, 200);
    return c.json(result);
  };
}
