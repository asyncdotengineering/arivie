/* SPDX-License-Identifier: Apache-2.0 */
import { defineSubscription } from "@arivie/core/triggers";
import { channel } from "../channels/ops-alert.js";

export const subscription = defineSubscription({
  source: channel,
  filter: (event) => event.type === "ops.closeout.alert",
  target: {
    kind: "agent",
    id: "arivie",
    instanceId: (event) => event.metadata.conversationKey ?? "closeout:unknown",
    resourceId: (event) => event.metadata.resourceKey ?? "northstar-hospitality",
    input: (event) =>
      `A POS closeout alert arrived. Summarize the issue in one sentence. ` +
      `Payload: ${JSON.stringify(event.payload)}`,
  },
});

export default subscription;
