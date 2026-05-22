/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Fetch persisted messages for a specific thread via Mastra Memory.
 * Replaces vercel/chatbot's Drizzle-backed /api/messages.
 */
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { getArivie } from "@/lib/arivie";
import { auth } from "@/lib/auth";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user?.id ?? "anonymous";

  const instance = await getArivie();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const memory: any = await (instance.agent as any).getMemory?.();
  if (!memory) {
    return NextResponse.json({ messages: [] });
  }

  let messages: unknown[] = [];
  try {
    if (typeof memory.recall === "function") {
      const recalled = await memory.recall({
        threadId: id,
        resourceId: userId,
      });
      messages = recalled?.messages ?? [];
    } else if (typeof memory.getMessages === "function") {
      messages = await memory.getMessages({ threadId: id, resourceId: userId });
    }
  } catch (err) {
    console.error("[arivie-chat] failed to fetch messages", err);
  }

  return NextResponse.json({ messages });
}
