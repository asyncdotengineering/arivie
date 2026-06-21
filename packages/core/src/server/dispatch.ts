/* SPDX-License-Identifier: Apache-2.0 */
import type { ChannelDefinition } from "../triggers/channel.js";
import type { SubscriptionDefinition } from "../triggers/subscription.js";
import type { TriggerEvent } from "../triggers/types.js";
import type { ArivieApp } from "../define-app.js";

function resolveSourceName(
  source: SubscriptionDefinition<TriggerEvent>["source"],
): string {
  if (typeof source === "string") return source;
  if ("name" in source) return source.name;
  return source.id;
}

export async function dispatchEvent(
  event: TriggerEvent,
  sourceName: string,
  app: ArivieApp,
  subscriptions: SubscriptionDefinition<TriggerEvent>[],
): Promise<void> {
  for (const sub of subscriptions) {
    if (resolveSourceName(sub.source) !== sourceName) continue;
    if (sub.filter && !sub.filter(event)) continue;

    const target = sub.target;
    const instanceId =
      typeof target.instanceId === "function"
        ? await target.instanceId(event)
        : target.instanceId ?? event.metadata.conversationKey ?? "default";

    const resourceId =
      typeof target.resourceId === "function"
        ? await target.resourceId(event)
        : target.resourceId ?? event.metadata.resourceKey ?? instanceId;

    const input =
      typeof target.input === "function"
        ? await target.input(event)
        : target.input ?? event.payload;
    const inputRecord =
      input != null && typeof input === "object" && !Array.isArray(input)
        ? (input as Record<string, unknown>)
        : undefined;
    const messages =
      typeof input === "string"
        ? undefined
        : Array.isArray(input)
          ? input
          : Array.isArray(inputRecord?.messages)
            ? inputRecord.messages
          : [{ role: "user", content: JSON.stringify(input) }];

    if (target.kind === "agent") {
      await app.sessions.create({
        agent: target.id,
        ...(messages !== undefined ? { messages } : {}),
        ...(typeof input === "string" ? { prompt: input } : {}),
        session: { id: instanceId, resource: resourceId },
        user: {
          userId: resourceId,
          raw: event,
        },
        metadata: {
          triggerType: event.type,
          provider: event.metadata.provider,
        },
      });
    } else if (target.kind === "workflow") {
      throw new Error("Workflow subscription target not supported by ArivieApp");
    } else if (target.kind === "skill") {
      throw new Error("Skill subscription target not yet implemented");
    }
  }
}

export type { ChannelDefinition };
