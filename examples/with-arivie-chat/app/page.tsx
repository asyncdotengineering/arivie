/* SPDX-License-Identifier: Apache-2.0 */
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ChatShell } from "@/components/chat-shell";
import { auth } from "@/lib/auth";

export default async function Home() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect("/login");
  }
  return <ChatShell userId={session.user.id} userEmail={session.user.email} />;
}
