/* SPDX-License-Identifier: Apache-2.0 */
import { Hono } from "hono";
import type { ArivieApp } from "../define-app.js";
import type { ChannelDefinition } from "../triggers/channel.js";
import type { SubscriptionDefinition } from "../triggers/subscription.js";
import type { TriggerEvent } from "../triggers/types.js";
import { makeChannelRouteHandler } from "./channel-route.js";
import { discoverChannels, discoverSubscriptions } from "./discovery.js";

export interface ArivieServerOptions {
  app: ArivieApp;
  channels?: ChannelDefinition<unknown, TriggerEvent>[];
  subscriptions?: SubscriptionDefinition<TriggerEvent>[];
}

export interface CreateArivieServerOptions {
  rootDir?: string;
}

export async function arivie(options: ArivieServerOptions): Promise<Hono> {
  const app = new Hono();
  app.route("/", options.app.hono);

  const channels = options.channels ?? [];
  const subscriptions = options.subscriptions ?? [];
  const channelHandler = makeChannelRouteHandler({ channels, subscriptions, app: options.app });

  app.all("/channels/:name", channelHandler);
  app.all("/channels/:name/:suffix{.+}", channelHandler);

  return app;
}

export async function createArivieServer(
  arivieApp: ArivieApp,
  options?: CreateArivieServerOptions,
): Promise<{ instance: ArivieApp; app: Hono }> {
  const rootDir = options?.rootDir ?? process.cwd();
  const channels = await discoverChannels(rootDir);
  const subscriptions = await discoverSubscriptions(rootDir);
  const app = await arivie({ app: arivieApp, channels, subscriptions });
  return { instance: arivieApp, app };
}
