/* SPDX-License-Identifier: Apache-2.0 */
import type { ChannelDefinition } from "../triggers/channel.js";
import type { SubscriptionDefinition } from "../triggers/subscription.js";
import type { TriggerEvent } from "../triggers/types.js";
import type { ArivieInstance } from "../types.js";

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
  instance: ArivieInstance,
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

    if (target.kind === "agent") {
      const agent = instance.mastra.getAgent(target.id);
      await agent.generate(input as Parameters<typeof agent.generate>[0], {
        memory: { thread: instanceId, resource: resourceId },
      });
    } else if (target.kind === "workflow") {
      const workflow = instance.mastra.getWorkflow(target.id);
      const run = await workflow.createRun();
      await run.start({ inputData: input });
    } else if (target.kind === "skill") {
      throw new Error("Skill subscription target not yet implemented");
    }
  }
}

export type { ChannelDefinition };
