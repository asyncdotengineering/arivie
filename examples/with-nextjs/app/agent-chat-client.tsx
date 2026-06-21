/* SPDX-License-Identifier: Apache-2.0 */
"use client";

import { ArivieChat } from "@arivie/react/chat";

export function AppChat({ userId = "demo-user" }: { userId?: string }) {
  return <ArivieChat userId={userId} endpoint="/api/chat" />;
}
