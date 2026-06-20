/* SPDX-License-Identifier: Apache-2.0 */
import { MastraServer } from "@mastra/hono";
import { Hono } from "hono";
import type { ArivieInstance } from "../types.js";
import type { ChannelDefinition } from "../triggers/channel.js";
import type { SubscriptionDefinition } from "../triggers/subscription.js";
import type { TriggerEvent } from "../triggers/types.js";
import { makeChannelRouteHandler } from "./channel-route.js";
import { discoverChannels, discoverSubscriptions } from "./discovery.js";

export interface ArivieServerOptions {
  instance: ArivieInstance;
  channels?: ChannelDefinition<unknown, TriggerEvent>[];
  subscriptions?: SubscriptionDefinition<TriggerEvent>[];
}

export interface CreateArivieServerOptions {
  rootDir?: string;
}

export async function arivie(options: ArivieServerOptions): Promise<Hono> {
  const app = new Hono();
  const server = new MastraServer({ app, mastra: options.instance.mastra });
  await server.init();

  const channels = options.channels ?? [];
  const subscriptions = options.subscriptions ?? [];
  const channelHandler = makeChannelRouteHandler({ channels, subscriptions, instance: options.instance });

  app.all("/channels/:name", channelHandler);
  app.all("/channels/:name/:suffix{.+}", channelHandler);

  return app;
}

export async function createArivieServer(
  instance: ArivieInstance,
  options?: CreateArivieServerOptions,
): Promise<{ instance: ArivieInstance; app: Hono }> {
  const rootDir = options?.rootDir ?? process.cwd();
  const channels = await discoverChannels(rootDir);
  const subscriptions = await discoverSubscriptions(rootDir);
  const app = await arivie({ instance, channels, subscriptions });
  return { instance, app };
}
