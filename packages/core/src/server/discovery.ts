/* SPDX-License-Identifier: Apache-2.0 */
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { ChannelDefinition } from "../triggers/channel.js";
import type { SubscriptionDefinition } from "../triggers/subscription.js";
import type { TriggerEvent } from "../triggers/types.js";

const MODULE_EXTENSIONS = /\.(ts|js|mts|mjs)$/;

export interface DiscoveredChannel {
  name: string;
  filePath: string;
  channel: ChannelDefinition<unknown, TriggerEvent>;
}

export interface DiscoveredSubscription {
  filePath: string;
  subscription: SubscriptionDefinition<TriggerEvent>;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await readdir(path);
    return true;
  } catch {
    return false;
  }
}

async function discoverModules<T>(
  rootDir: string,
  kind: "channels" | "subscriptions",
  extract: (mod: Record<string, unknown>, filePath: string) => T | undefined,
): Promise<T[]> {
  const dir = join(rootDir, kind);
  if (!(await fileExists(dir))) return [];

  const entries = await readdir(dir, { withFileTypes: true });
  const modules: T[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!MODULE_EXTENSIONS.test(entry.name)) continue;

    const filePath = join(dir, entry.name);
    const mod = (await import(filePath)) as Record<string, unknown>;
    const extracted = extract(mod, filePath);
    if (extracted) modules.push(extracted);
  }

  return modules;
}

export async function discoverChannels(
  rootDir: string,
): Promise<ChannelDefinition<unknown, TriggerEvent>[]> {
  const discovered = await discoverModules(rootDir, "channels", (mod, filePath) => {
    const channel = mod.channel;
    if (!channel || typeof channel !== "object") {
      throw new Error(`Channel module ${filePath} must export a named "channel"`);
    }
    return channel as ChannelDefinition<unknown, TriggerEvent>;
  });
  return discovered;
}

export async function discoverSubscriptions(
  rootDir: string,
): Promise<SubscriptionDefinition<TriggerEvent>[]> {
  const discovered = await discoverModules(rootDir, "subscriptions", (mod, filePath) => {
    const subscription = mod.subscription;
    if (!subscription || typeof subscription !== "object") {
      throw new Error(`Subscription module ${filePath} must export a named "subscription"`);
    }
    return subscription as SubscriptionDefinition<TriggerEvent>;
  });
  return discovered;
}


