/* SPDX-License-Identifier: Apache-2.0 */

import { runWithUserContext } from "@arivie/core";
import { handleChatStream } from "@mastra/ai-sdk";
import { createUIMessageStreamResponse } from "ai";
import { headers } from "next/headers";
import { getArivie } from "@/lib/arivie";
import { auth } from "@/lib/auth";

export const maxDuration = 60;

export async function POST(req: Request) {
  const params: any = await req.json();
  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user?.id ?? "anonymous";
  const instance = await getArivie();

  const memory = {
    thread:
      params?.memory?.thread ??
      `chat-${new Date().toISOString().replace(/[:.]/g, "").slice(0, 17)}`,
    resource: params?.memory?.resource ?? userId,
  };

  return runWithUserContext(
    {
      userId,
      permissions: ["analytics:read"],
      dbRole: process.env.ARIVIE_DB_ROLE ?? "arivie_reader",
    },
    async () => {
      const stream = await handleChatStream({
        mastra: instance.mastra,
        agentId: "arivie",
        version: "v6",
        params: { ...params, memory },
        messageMetadata: () => ({ createdAt: new Date().toISOString() }),
      });
      return createUIMessageStreamResponse({ stream });
    },
  );
}
