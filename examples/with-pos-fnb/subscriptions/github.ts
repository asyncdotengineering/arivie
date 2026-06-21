/* SPDX-License-Identifier: Apache-2.0 */
import { defineSubscription } from "@arivie/core/triggers";
import { channel } from "../channels/github.js";

export const subscription = defineSubscription({
  source: channel,
  target: {
    kind: "agent",
    id: "analyst",
    instanceId: (event) => event.metadata.conversationKey ?? "github:semantic-layer",
    resourceId: "lumiere-chain",
    input: () => "A GitHub push touched analytics code. Reply with exactly GITHUB_EVENT_OK and nothing else.",
  },
});

export default subscription;
