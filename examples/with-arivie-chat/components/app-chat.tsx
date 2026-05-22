/* SPDX-License-Identifier: Apache-2.0 */
"use client";
import { ArivieChat } from "@arivie/react/chat";
import { authClient } from "@/lib/auth-client";

/**
 * Thin client shim around `<ArivieChat>` — wires the starter's Better
 * Auth sign-out flow. Everything else (chat stream, artifact pane,
 * thread list, mobile drawer) lives in `@arivie/react/chat`.
 */
export function AppChat({
  userId,
  userEmail,
}: {
  userId: string;
  userEmail: string | null;
}) {
  return (
    <ArivieChat
      userId={userId}
      userEmail={userEmail}
      onSignOut={async () => {
        await authClient.signOut();
        window.location.href = "/login";
      }}
    />
  );
}
