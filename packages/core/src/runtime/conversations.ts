/* SPDX-License-Identifier: Apache-2.0 */
import { Memory } from "@mastra/memory";
import type { ArivieApp } from "../define-app.js";

/** A past conversation thread, for listing/resuming in a chat UI. */
export interface ConversationSummary {
  id: string;
  title?: string;
  updatedAt: string;
}

/**
 * List a resource's past conversation threads from the app's memory store,
 * newest first — the backing for "continue a past chat" in `arivie chat`.
 * `resourceId` is the owner the threads are scoped to (the chat user id).
 */
export async function listConversations(
  app: ArivieApp,
  resourceId: string,
): Promise<ConversationSummary[]> {
  return listConversationsFor(app.memory, resourceId);
}

/**
 * Same as {@link listConversations} but keyed directly to a memory storage —
 * used by the server's `/api/threads` route during app construction (before
 * the `ArivieApp` object exists).
 */
export async function listConversationsFor(
  storage: ArivieApp["memory"],
  resourceId: string,
): Promise<ConversationSummary[]> {
  const memory = new Memory({ storage });
  const result = (await memory.listThreads({
    filter: { resourceId },
    perPage: false,
  })) as {
    threads?: Array<{ id: string; title?: string; updatedAt: Date | string }>;
  };
  const threads = result.threads ?? [];
  return threads
    .map((thread) => ({
      id: thread.id,
      ...(thread.title !== undefined ? { title: thread.title } : {}),
      updatedAt: new Date(thread.updatedAt).toISOString(),
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
