/* SPDX-License-Identifier: Apache-2.0 */
import type { ArivieApp, ArivieEvent } from "@arivie/core";

export interface SessionChatUser {
  userId: string;
  permissions: string[];
  dbRole: string;
}

export async function runAnalystPrompt(
  app: ArivieApp,
  input: {
    prompt: string;
    user: SessionChatUser;
    conversationId: string;
    resourceId?: string;
  },
): Promise<string> {
  const handle = await app.sessions.create({
    agent: "analyst",
    prompt: input.prompt,
    user: input.user,
    session: {
      id: input.conversationId,
      resource: input.resourceId ?? input.user.userId,
    },
  });

  const reader = handle.stream.getReader();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const event = value as ArivieEvent;
    if (event.type === "run.completed") {
      text = typeof event.payload.text === "string" ? event.payload.text : "";
    }
  }
  return text;
}
