/* SPDX-License-Identifier: Apache-2.0 */
import { createGithubPushChannel } from "@arivie/github";

export const channel = createGithubPushChannel({
  webhookSecret: process.env.GITHUB_WEBHOOK_SECRET ?? "dev-secret",
});

export default channel;
