/* SPDX-License-Identifier: Apache-2.0 */
/**
 * List the signed-in user's chat threads via Mastra Memory — replaces
 * vercel/chatbot's Drizzle-backed /api/history. One source of truth:
 * the same Memory store the agent writes to.
 */
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { getArivie } from "@/lib/arivie";
import { auth } from "@/lib/auth";

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user?.id ?? "anonymous";

  const instance = await getArivie();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const memory: any = await (instance.agent as any).getMemory?.();
  if (!memory) {
    return NextResponse.json({ threads: [] });
  }

  // Mastra Memory exposes thread-listing per resource. The exact method
  // name varies by version; try the canonical ones in order. Older
  // versions return an array; v1 wraps it in { threads, total, page, ... }.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let raw: any = [];
  try {
    if (typeof memory.getThreadsByResourceId === "function") {
      raw = await memory.getThreadsByResourceId({ resourceId: userId });
    } else if (typeof memory.listThreads === "function") {
      raw = await memory.listThreads({ resourceId: userId });
    }
  } catch (err) {
    console.error("[arivie-chat] failed to list threads", err);
  }

  const threads: Array<{ id: string; title?: string; createdAt?: string }> =
    Array.isArray(raw) ? raw : Array.isArray(raw?.threads) ? raw.threads : [];

  return NextResponse.json({ threads });
}

export async function POST() {
  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user?.id ?? "anonymous";

  const instance = await getArivie();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const memory: any = await (instance.agent as any).getMemory?.();
  if (!memory) {
    return NextResponse.json({ error: "memory unavailable" }, { status: 503 });
  }

  const thread = await memory.createThread({
    resourceId: userId,
    title: `Chat ${new Date().toLocaleString()}`,
  });

  return NextResponse.json({ thread });
}
